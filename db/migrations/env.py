"""Alembic environment: plain SQL migrations (no ORM models), URL from DATABASE_URL."""

import os

from alembic import context
from sqlalchemy import create_engine, pool

config = context.config

URL = os.environ.get("DATABASE_URL", "postgresql+psycopg://board:board@localhost:5434/board")
# The app uses postgres:// URLs; SQLAlchemy needs the driver in the scheme
if URL.startswith("postgres://") or URL.startswith("postgresql://"):
    URL = "postgresql+psycopg://" + URL.split("://", 1)[1]


def run_migrations_offline() -> None:
    context.configure(url=URL, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(URL, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
