dev:
	docker compose up --build -d

stop:
	docker compose down

logs:
	docker compose logs -f

db-migrate:
	pnpm --filter @psi/db migrate

db-seed:
	pnpm --filter @psi/db seed
