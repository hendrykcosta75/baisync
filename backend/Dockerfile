# Stage 1: Build the application (with dependency caching)
FROM rust:1.88-slim AS builder
WORKDIR /app

# 1) Copy manifests and create a dummy main to cache dependency compilation
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -rf src

# 2) Copy real source and build (only app code recompiles)
COPY src ./src
RUN touch src/main.rs && cargo build --release

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
