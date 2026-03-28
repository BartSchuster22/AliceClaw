dev:
	docker compose up --build -d

stop:
	docker compose down

logs:
	docker compose logs -f

db-migrate:
	docker compose exec backend-api pnpm --filter @psi/db migrate

db-seed:
	docker compose exec backend-api pnpm --filter @psi/db seed
