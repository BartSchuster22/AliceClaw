dev:
	docker compose up --build -d

stop:
	docker compose down

logs:
	docker compose logs -f

db-migrate:
	docker compose run --rm backend-api sh -lc "pnpm install && pnpm --filter @psi/db migrate"

db-seed:
	docker compose run --rm backend-api sh -lc "pnpm install && pnpm --filter @psi/db seed"
