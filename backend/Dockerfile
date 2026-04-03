# Stage 1: Build the application
FROM rust:1.88-slim AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

# Stage 2: Production runner
FROM debian:bookworm-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*

RUN adduser --system --no-create-home appuser

COPY --from=builder /app/target/release/backend ./inertial-eclipse-backend
COPY migrations ./migrations

USER appuser

EXPOSE 3001

CMD ["./inertial-eclipse-backend"]
