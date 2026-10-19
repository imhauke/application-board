"""Initial schema: the offers, your tracking, what was read from each posting, companies with
their application rules, crawler runs and the offers turned down.

Nested structures that are always read whole (cities, visas, sources, requirements…) are JSONB;
what is filtered, joined or updated on its own has its own column.

Revision ID: 0001
Revises:
Create Date: 2026-10-16
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

TS = sa.TIMESTAMP(timezone=True)


def upgrade() -> None:
    op.create_table(
        "companies",
        sa.Column("name", sa.Text, primary_key=True),
        sa.Column("sector", sa.Text, nullable=False, server_default=""),
        sa.Column("prestige", sa.Text, nullable=False, server_default="C"),
        # Pay level 1-5
        sa.Column("pay", sa.SmallInteger, nullable=False, server_default="3"),
        sa.Column("aliases", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("on_list", sa.Boolean, nullable=False, server_default=sa.false()),
        # Application rules (limits, cooldowns…) with their quotes and sources
        sa.Column("policy", JSONB),
        sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("prestige IN ('S', 'A', 'B', 'C')", name="companies_prestige"),
    )

    op.create_table(
        "offers",
        sa.Column("id", sa.Text, primary_key=True),
        # Which board (and crawler) it belongs to
        sa.Column("board", sa.Text, nullable=False, server_default="global"),
        sa.Column("company", sa.Text, nullable=False),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("first_seen_at", TS),
        sa.Column("posted_at", sa.Date),
        # The whole offer as the app uses it (cities, visas, sources, CV, interview…)
        sa.Column("data", JSONB, nullable=False),
        sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("kind IN ('intern', 'grad')", name="offers_kind"),
    )
    op.create_index("offers_board_idx", "offers", ["board"])
    op.create_index("offers_company_idx", "offers", ["company"])
    op.create_index("offers_first_seen_idx", "offers", ["first_seen_at"])

    op.create_table(
        "tracking",
        sa.Column("offer_id", sa.Text, sa.ForeignKey("offers.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("status", sa.Text, nullable=False, server_default=""),
        sa.Column("interested", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("notes", sa.Text, nullable=False, server_default=""),
        sa.Column("updated_at", TS),
        sa.Column("applied_at", TS),
        sa.Column("trashed", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("trashed_at", TS),
        # When you opened it or marked it as seen: until then a new offer stays in "New"
        sa.Column("seen_at", TS),
        # When it reached an OA or interview: waiting periods count from here, even after "rejected"
        sa.Column("assessed_at", TS),
        # rejected: the company turned you down (it still counts as an application sent) · dropped: you dropped it
        sa.CheckConstraint(
            "status IN ('', 'preparing', 'applied', 'interview', 'offer', 'rejected', 'dropped')",
            name="tracking_status",
        ),
    )
    op.create_index("tracking_status_idx", "tracking", ["status"], postgresql_where=sa.text("status <> ''"))

    op.create_table(
        "postings",
        sa.Column("offer_id", sa.Text, sa.ForeignKey("offers.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("fetched_at", TS, nullable=False),
        sa.Column("ok", sa.Boolean, nullable=False),
        sa.Column("via", sa.Text, nullable=False, server_default=""),
        sa.Column("url", sa.Text, nullable=False, server_default=""),
        # The company took it down while trackers still list it
        sa.Column("gone", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("date_posted", sa.Date),
        # Everything read from the posting except its full text
        sa.Column("details", JSONB, nullable=False),
        # Full text (gzip + base64), read only to re-analyse postings
        sa.Column("text_z", sa.Text),
    )

    op.create_table(
        "rejected",
        sa.Column("url_key", sa.Text, primary_key=True),
        sa.Column("board", sa.Text, nullable=False, server_default="global"),
        sa.Column("company", sa.Text, nullable=False),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column("at", TS, nullable=False),
        # Graduation date and whole years of experience it was judged with
        sa.Column("grad", sa.Text, nullable=False),
        sa.Column("exp", sa.SmallInteger),
        # The language it was turned down for, so it is judged again if your CV adds it
        sa.Column("lang", sa.Text),
    )

    op.create_table(
        "crawls",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("board", sa.Text, nullable=False, server_default="global"),
        sa.Column("started_at", TS, nullable=False),
        sa.Column("finished_at", TS),
        sa.Column("ok", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("data", JSONB, nullable=False),
    )
    op.create_index("crawls_board_started_idx", "crawls", ["board", sa.text("started_at DESC")])

    op.create_table(
        "ui_state",
        sa.Column("board", sa.Text, nullable=False),
        sa.Column("key", sa.Text, nullable=False),
        sa.Column("value", JSONB),
        sa.PrimaryKeyConstraint("board", "key"),
    )

    # Shared texts (eligibility notes, interview notes, CV reasons) and metadata
    op.create_table(
        "reference",
        sa.Column("key", sa.Text, primary_key=True),
        sa.Column("value", JSONB, nullable=False),
    )


def downgrade() -> None:
    for table in ("reference", "ui_state", "crawls", "rejected", "postings", "tracking", "offers", "companies"):
        op.drop_table(table)
