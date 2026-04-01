import type { ClientChannel } from 'ssh2';
import { randomUUID } from 'node:crypto';

import { NodeSSH } from 'node-ssh';

export type ContainerRuntimeStatus = 'running' | 'starting' | 'unhealthy' | 'stopped' | 'not_found';

export interface DockerAdapter {
  deployContainer(params: {
    hostIp: string;
    containerName: string;
    dockerImage: string;
    dockerTag: string;
    hostPort: number;
    containerPort: number;
    cpuMillicores: number;
    memoryMb: number;
    envVars: Record<string, string>;
    healthCheckPath: string;
  }): Promise<{ containerId: string }>;

  getContainerStatus(params: {
    hostIp: string;
    containerName: string;
  }): Promise<ContainerRuntimeStatus>;

  stopContainer(params: {
    hostIp: string;
    containerName: string;
  }): Promise<void>;

  removeContainer(params: {
    hostIp: string;
    containerName: string;
  }): Promise<void>;

  getContainerStats?(params: {
    hostIp: string;
    containerName: string;
  }): Promise<{ cpuPercent: number; memoryMb: number }>;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function buildEnvArgs(envVars: Record<string, string>): string {
  return Object.entries(envVars)
    .map(([key, value]) => `-e ${shellEscape(`${key}=${value}`)}`)
    .join(' ');
}

function buildHealthCommand(containerPort: number, healthCheckPath: string): string {
  return `curl -sf http://localhost:${containerPort}${healthCheckPath} || exit 1`;
}

function normalizeStatusOutput(output: string): ContainerRuntimeStatus {
  const normalized = output.trim().toLowerCase();

  if (!normalized || normalized.includes('no such object') || normalized.includes('no such container')) {
    return 'not_found';
  }

  if (normalized.includes('running healthy')) {
    return 'running';
  }

  if (normalized.includes('running unhealthy')) {
    return 'unhealthy';
  }

  if (normalized.includes('running starting') || normalized === 'running') {
    return 'starting';
  }

  if (normalized.includes('exited') || normalized.includes('dead') || normalized.includes('created')) {
    return 'stopped';
  }

  return 'not_found';
}

function parseStatsOutput(output: string): { cpuPercent: number; memoryMb: number } {
  const trimmed = output.trim();
  if (!trimmed) {
    return { cpuPercent: 0, memoryMb: 0 };
  }

  const [cpuRaw = '0%', memoryRaw = '0MiB'] = trimmed.split(/\s+/, 2);
  const cpuPercent = Number.parseFloat(cpuRaw.replace('%', '')) || 0;
  const memoryMatch = memoryRaw.match(/([0-9.]+)([KMG]i?B)/i);

  if (!memoryMatch) {
    return { cpuPercent, memoryMb: 0 };
  }

  const [, valueRaw, unitRaw] = memoryMatch;
  const value = Number.parseFloat(valueRaw);
  const unit = unitRaw.toLowerCase();

  let memoryMb = value;
  if (unit.startsWith('g')) {
    memoryMb = value * 1024;
  } else if (unit.startsWith('k')) {
    memoryMb = value / 1024;
  }

  return { cpuPercent, memoryMb };
}

async function sshExec(ssh: NodeSSH, command: string): Promise<{ stdout: string; stderr: string }> {
  const result = await ssh.execCommand(command, {
    execOptions: {
      pty: false,
    } as ClientChannel['execOptions'],
  });

  if (result.code && result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `Remote command failed with code ${result.code}`);
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export class SshDockerAdapter implements DockerAdapter {
  private getSshUser() {
    return process.env.PROVISIONING_SSH_USER ?? 'root';
  }

  private getPrivateKey() {
    const key = process.env.PROVISIONING_SSH_PRIVATE_KEY;
    if (!key) {
      throw new Error('PROVISIONING_SSH_PRIVATE_KEY is required for SshDockerAdapter');
    }

    return key;
  }

  private async withConnection<T>(hostIp: string, fn: (ssh: NodeSSH) => Promise<T>): Promise<T> {
    const ssh = new NodeSSH();

    await ssh.connect({
      host: hostIp,
      username: this.getSshUser(),
      privateKey: this.getPrivateKey(),
    });

    try {
      return await fn(ssh);
    } finally {
      ssh.dispose();
    }
  }

  async deployContainer(params: {
    hostIp: string;
    containerName: string;
    dockerImage: string;
    dockerTag: string;
    hostPort: number;
    containerPort: number;
    cpuMillicores: number;
    memoryMb: number;
    envVars: Record<string, string>;
    healthCheckPath: string;
  }): Promise<{ containerId: string }> {
    return this.withConnection(params.hostIp, async (ssh) => {
      const envArgs = buildEnvArgs(params.envVars);
      const healthCommand = shellEscape(buildHealthCommand(params.containerPort, params.healthCheckPath));
      const imageRef = `${params.dockerImage}:${params.dockerTag}`;
      const command = [
        'docker run -d',
        `--name ${shellEscape(params.containerName)}`,
        '--restart unless-stopped',
        `--cpus=${params.cpuMillicores / 1000}`,
        `--memory=${params.memoryMb}m`,
        `-p ${params.hostPort}:${params.containerPort}`,
        envArgs,
        `--health-cmd=${healthCommand}`,
        '--health-interval=10s',
        '--health-retries=3',
        '--health-timeout=5s',
        imageRef,
      ]
        .filter(Boolean)
        .join(' ');

      try {
        const { stdout } = await sshExec(ssh, command);
        return { containerId: stdout.trim() };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.toLowerCase().includes('is already in use by container')) {
          throw new Error(`ContainerAlreadyExistsError:${params.containerName}`);
        }

        throw error;
      }
    });
  }

  async getContainerStatus(params: {
    hostIp: string;
    containerName: string;
  }): Promise<ContainerRuntimeStatus> {
    return this.withConnection(params.hostIp, async (ssh) => {
      try {
        const { stdout } = await sshExec(
          ssh,
          `docker inspect --format='{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' ${shellEscape(params.containerName)}`,
        );
        return normalizeStatusOutput(stdout);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.toLowerCase().includes('no such object') || message.toLowerCase().includes('no such container')) {
          return 'not_found';
        }

        throw error;
      }
    });
  }

  async stopContainer(params: { hostIp: string; containerName: string }): Promise<void> {
    await this.withConnection(params.hostIp, async (ssh) => {
      try {
        await sshExec(ssh, `docker stop ${shellEscape(params.containerName)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.toLowerCase().includes('no such container')) {
          throw error;
        }
      }
    });
  }

  async removeContainer(params: { hostIp: string; containerName: string }): Promise<void> {
    await this.withConnection(params.hostIp, async (ssh) => {
      try {
        await sshExec(ssh, `docker rm -f ${shellEscape(params.containerName)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.toLowerCase().includes('no such container')) {
          throw error;
        }
      }
    });
  }

  async getContainerStats(params: {
    hostIp: string;
    containerName: string;
  }): Promise<{ cpuPercent: number; memoryMb: number }> {
    return this.withConnection(params.hostIp, async (ssh) => {
      const { stdout } = await sshExec(
        ssh,
        `docker stats --no-stream --format '{{.CPUPerc}} {{.MemUsage}}' ${shellEscape(params.containerName)}`,
      );
      return parseStatsOutput(stdout.split('/')[0] ?? stdout);
    });
  }
}

const mockStatusCalls = new Map<string, number>();

export class MockDockerAdapter implements DockerAdapter {
  async deployContainer(): Promise<{ containerId: string }> {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    return { containerId: `mock-${randomUUID()}` };
  }

  async getContainerStatus(params: {
    hostIp: string;
    containerName: string;
  }): Promise<ContainerRuntimeStatus> {
    const key = `${params.hostIp}:${params.containerName}`;
    const calls = (mockStatusCalls.get(key) ?? 0) + 1;
    mockStatusCalls.set(key, calls);

    if (calls === 1) {
      return 'starting';
    }

    return 'running';
  }

  async stopContainer(): Promise<void> {
    return;
  }

  async removeContainer(): Promise<void> {
    return;
  }

  async getContainerStats(): Promise<{ cpuPercent: number; memoryMb: number }> {
    return { cpuPercent: 12.5, memoryMb: 256 };
  }
}

export function getDockerAdapter(): DockerAdapter {
  if ((process.env.DOCKER_ADAPTER ?? '').toLowerCase() === 'ssh') {
    return new SshDockerAdapter();
  }

  if (process.env.NODE_ENV === 'production') {
    return new SshDockerAdapter();
  }

  return new MockDockerAdapter();
}
