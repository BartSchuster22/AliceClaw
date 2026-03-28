import { EventEmitter } from 'node:events';

import type { BillingEvent, BillingEventHandler } from './types.js';

export class BillingEventEmitter {
  private readonly emitter = new EventEmitter();

  emit(event: BillingEvent): void {
    this.emitter.emit(event.type, event);
  }

  on<TType extends BillingEvent['type']>(
    type: TType,
    handler: BillingEventHandler<TType>,
  ): void {
    this.emitter.on(type, handler as (event: BillingEvent) => void);
  }
}
