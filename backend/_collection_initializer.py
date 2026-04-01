"""
MongoDB collection initializer.

Provides idempotent helpers to create both regular and time series collections
with indexes at application startup.  Extends MongoDBConnector so it can
manage its own connection (or reuse env-var defaults).
"""
from __future__ import annotations

import logging
from typing import Any

from pymongo import ASCENDING
from pymongo.errors import CollectionInvalid
from bson.codec_options import CodecOptions
from bson.datetime_ms import DatetimeConversion

from db.mdb import MongoDBConnector

logger = logging.getLogger(__name__)


class CollectionInitializer(MongoDBConnector):
    """One-stop class for creating collections and ensuring indexes exist."""

    def __init__(self, uri=None, database_name=None, appname=None):
        super().__init__(uri, database_name, appname)

    # ------------------------------------------------------------------
    # Time Series collections
    # ------------------------------------------------------------------

    def create_timeseries_collection(
        self,
        collection_name: str,
        time_field: str,
        metafield: str,
        granularity: str = "minutes",
        expire_after_seconds: int | None = None,
    ) -> None:
        """Create a time series collection if it doesn't already exist."""
        if collection_name in self.db.list_collection_names():
            logger.info("Collection '%s' already exists — skipping.", collection_name)
            return

        codec_options = CodecOptions(
            datetime_conversion=DatetimeConversion.DATETIME_AUTO,
        )
        options: dict[str, Any] = {
            "timeseries": {
                "timeField": time_field,
                "metaField": metafield,
                "granularity": granularity,
            },
            "codec_options": codec_options,
        }
        if expire_after_seconds is not None:
            options["expireAfterSeconds"] = expire_after_seconds

        try:
            self.db.create_collection(collection_name, **options)
            self.db[collection_name].create_index([(time_field, ASCENDING)])
            logger.info("Time series collection '%s' created.", collection_name)
        except CollectionInvalid:
            logger.info("Collection '%s' already exists.", collection_name)
        except Exception:
            logger.exception("Failed to create time series collection '%s'.", collection_name)

    # ------------------------------------------------------------------
    # Regular collections with indexes
    # ------------------------------------------------------------------

    def ensure_collection_with_indexes(
        self,
        collection_name: str,
        indexes: list[dict[str, Any]] | None = None,
    ) -> None:
        """
        Create a regular collection (if needed) and ensure indexes exist.

        Parameters
        ----------
        collection_name : str
            The collection to create / ensure.
        indexes : list[dict], optional
            Each dict describes one index with keys:
              - ``fields``: list of (field, direction) tuples,
                            e.g. ``[("meta.patient_id", 1)]``
              - ``unique``:  bool (default False)
        """
        if collection_name not in self.db.list_collection_names():
            try:
                self.db.create_collection(collection_name)
                logger.info("Collection '%s' created.", collection_name)
            except CollectionInvalid:
                logger.info("Collection '%s' already exists.", collection_name)
            except Exception:
                logger.exception("Failed to create collection '%s'.", collection_name)
                return

        if not indexes:
            return

        collection = self.db[collection_name]
        for idx in indexes:
            fields = idx["fields"]
            unique = idx.get("unique", False)
            try:
                collection.create_index(fields, unique=unique)
                field_names = ", ".join(f[0] for f in fields)
                logger.info(
                    "Index on (%s) ensured for '%s'%s.",
                    field_names,
                    collection_name,
                    " [unique]" if unique else "",
                )
            except Exception:
                logger.exception(
                    "Failed to create index on '%s'.",
                    collection_name,
                )
