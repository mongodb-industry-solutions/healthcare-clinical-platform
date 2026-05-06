import logging
import os

from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


class MongoDBConnector:
    """A class to provide access to a MongoDB database.

    Attributes:
        uri: The connection string URI for the MongoDB database.
        database_name: The name of the database to connect to.
        appname: The name of the application connecting to the database.
    """

    def __init__(self, uri=None, database_name=None, appname=None, auto_encryption_opts=None):
        """Initialize the MongoDBConnector instance."""
        self.uri = uri or os.getenv("MONGODB_URI")
        self.database_name = database_name or os.getenv("DATABASE_NAME")
        self.appname = appname or os.getenv("APP_NAME")

        kwargs: dict = {"appname": self.appname}
        if auto_encryption_opts is not None:
            kwargs["auto_encryption_opts"] = auto_encryption_opts

        self.client = MongoClient(self.uri, **kwargs)
        self.db = self.client[self.database_name]

        self._plain_client: MongoClient | None = None
        self._has_encryption = auto_encryption_opts is not None

    @property
    def plain_client(self) -> MongoClient:
        """A second MongoClient without auto-encryption.

        Used by the encryption server-view endpoint to read raw ciphertext
        from the database exactly as it is stored on disk.
        """
        if self._plain_client is None:
            self._plain_client = MongoClient(self.uri, appname=self.appname)
        return self._plain_client

    @property
    def plain_db(self):
        """Database handle from the plain (non-encrypting) client."""
        return self.plain_client[self.database_name]

    @property
    def has_encryption(self) -> bool:
        return self._has_encryption

    # QE internal metadata fields that must be stripped from application results.
    _QE_INTERNAL_FIELDS = frozenset({"__safeContent__"})

    @staticmethod
    def strip_qe_metadata(doc):
        """Remove Queryable Encryption internal fields from a document."""
        if doc is None:
            return None
        if isinstance(doc, dict):
            for key in MongoDBConnector._QE_INTERNAL_FIELDS:
                doc.pop(key, None)
        return doc

    def get_collection(self, collection_name):
        """Retrieve a collection."""
        if not collection_name:
            raise ValueError("Collection name must be provided.")
        return self.db[collection_name]

    def insert_one(self, collection_name, document):
        """Insert a single document into a collection."""
        collection = self.get_collection(collection_name)
        result = collection.insert_one(document)
        return result.inserted_id

    def insert_many(self, collection_name, documents):
        """Insert multiple documents into a collection."""
        collection = self.get_collection(collection_name)
        result = collection.insert_many(documents)
        return result.inserted_ids

    def find(self, collection_name, query={}, projection=None):
        """Retrieve documents from a collection."""
        collection = self.get_collection(collection_name)
        return list(collection.find(query, projection))

    def update_one(self, collection_name, query, update, upsert=False):
        """Update a single document in a collection."""
        collection = self.get_collection(collection_name)
        result = collection.update_one(query, update, upsert=upsert)
        return result.modified_count

    def update_many(self, collection_name, query, update, upsert=False):
        """Update multiple documents in a collection."""
        collection = self.get_collection(collection_name)
        result = collection.update_many(query, update, upsert=upsert)
        return result.modified_count

    def delete_one(self, collection_name, query):
        """Delete a single document from a collection."""
        collection = self.get_collection(collection_name)
        result = collection.delete_one(query)
        return result.deleted_count

    def delete_many(self, collection_name, query):
        """Delete multiple documents from a collection."""
        collection = self.get_collection(collection_name)
        result = collection.delete_many(query)
        return result.deleted_count