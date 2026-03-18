"""
AWS HealthLake FHIR API client.

Sends FHIR R4 resources to an AWS HealthLake data store using
SigV4-signed HTTP requests, following the same pattern as BedrockClient.

Required environment variables
-------------------------------
HEALTHLAKE_DATASTORE_ID  — the HealthLake data store ID
AWS_REGION               — AWS region (default: us-east-1)
AWS_PROFILE              — optional named profile (falls back to default chain)

The FHIR R4 base URL for a HealthLake data store is:
  https://healthlake.{region}.amazonaws.com/datastore/{datastore_id}/r4/

Supported operations
--------------------
send_bundle(bundle)          POST a FHIR transaction bundle
send_resource(resource_type, resource_id, resource)  PUT a single resource
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

import boto3
import requests
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


class HealthLakeClient:
    """
    Thin wrapper around the AWS HealthLake FHIR R4 REST API.

    Parameters
    ----------
    datastore_id : str | None
        HealthLake data store ID.  Falls back to env var HEALTHLAKE_DATASTORE_ID.
    region_name : str
        AWS region.  Falls back to env var AWS_REGION, then 'us-east-1'.
    aws_access_key : str | None
        Explicit access key.  If omitted, the standard boto3 credential chain is used.
    aws_secret_key : str | None
        Explicit secret key.  If omitted, the standard boto3 credential chain is used.
    """

    _SERVICE = "healthlake"

    def __init__(
        self,
        datastore_id: Optional[str] = None
    ) -> None:
        self.datastore_id = datastore_id or os.environ.get("HEALTHLAKE_DATASTORE_ID")
        if not self.datastore_id:
            raise ValueError(
                "HealthLake datastore ID must be provided or set via "
                "the HEALTHLAKE_DATASTORE_ID environment variable."
            )

        self.region = (
            # region_name
            os.environ.get("AWS_REGION")
        )

        # Build a boto3 session — honours AWS_PROFILE if set
        session_kwargs: dict[str, Any] = {"region_name": self.region}
        profile = os.environ.get("AWS_PROFILE")
        if profile:
            session_kwargs["profile_name"] = profile
        # if aws_access_key and aws_secret_key:
        #     session_kwargs["aws_access_key_id"]     = aws_access_key
        #     session_kwargs["aws_secret_access_key"] = aws_secret_key

        self._session     = boto3.Session(**session_kwargs)
        self._credentials = self._session.get_credentials()

        self.base_url = (
            f"https://healthlake.{self.region}.amazonaws.com"
            f"/datastore/{self.datastore_id}/r4/"
        )
        logger.info("HealthLakeClient initialised — base URL: %s", self.base_url)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def send_bundle(self, bundle: dict[str, Any]) -> dict[str, Any]:
        """
        POST a FHIR R4 transaction Bundle to HealthLake.

        Parameters
        ----------
        bundle : dict
            A FHIR R4 Bundle document with type='transaction'.

        Returns
        -------
        dict
            The HealthLake response body (a FHIR Bundle of type 'transaction-response').

        Raises
        ------
        requests.HTTPError
            If HealthLake returns a non-2xx status code.
        """
        return self._signed_request(
            method="POST",
            url=self.base_url,
            payload=bundle,
        )

    def send_resources_from_bundle(self, bundle: dict[str, Any]) -> tuple[int, list[str]]:
        """
        PUT each resource in a FHIR transaction Bundle to HealthLake individually.

        This is more reliable than POSTing the whole bundle because HealthLake
        has limited transaction bundle support (e.g. it rejects unknown extensions
        and non-standard fields at the bundle level).

        Parameters
        ----------
        bundle : dict
            A FHIR R4 Bundle document whose entries each contain a 'resource'.

        Returns
        -------
        tuple[int, list[str]]
            (number of resources successfully sent, list of error messages)
        """
        sent   = 0
        errors: list[str] = []

        for entry in bundle.get("entry", []):
            resource = entry.get("resource", {})
            resource_type = resource.get("resourceType")
            resource_id   = resource.get("id")

            if not resource_type or not resource_id:
                errors.append(f"Skipped entry — missing resourceType or id: {entry}")
                continue

            try:
                self.send_resource(resource_type, resource_id, resource)
                sent += 1
                logger.debug("Sent %s/%s", resource_type, resource_id)
            except Exception as exc:
                msg = f"{resource_type}/{resource_id}: {exc}"
                logger.warning("HealthLake resource send failed — %s", msg)
                errors.append(msg)

        return sent, errors

    def send_resource(
        self,
        resource_type: str,
        resource_id: str,
        resource: dict[str, Any],
    ) -> dict[str, Any]:
        """
        PUT a single FHIR R4 resource to HealthLake (upsert by ID).

        Parameters
        ----------
        resource_type : str
            FHIR resource type, e.g. 'Patient', 'Condition'.
        resource_id : str
            The resource's FHIR ID.
        resource : dict
            The full FHIR resource document.

        Returns
        -------
        dict
            The HealthLake response body.
        """
        url = f"{self.base_url}{resource_type}/{resource_id}"
        return self._signed_request(method="PUT", url=url, payload=resource)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _signed_request(
        self,
        method: str,
        url: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Build, SigV4-sign, and execute an HTTP request against the FHIR API.
        Returns the parsed JSON response body.
        """
        body    = json.dumps(payload)
        headers = {"Content-Type": "application/fhir+json"}

        # Build and sign the AWS request
        aws_request = AWSRequest(method=method, url=url, data=body, headers=headers)
        SigV4Auth(self._credentials, self._SERVICE, self.region).add_auth(aws_request)

        signed_headers = dict(aws_request.headers)

        logger.debug("%s %s", method, url)
        response = requests.request(
            method=method,
            url=url,
            headers=signed_headers,
            data=body,
            timeout=30,
        )

        if not response.ok:
            logger.error(
                "HealthLake %s %s → %s: %s",
                method, url, response.status_code, response.text[:1000],
            )
            # Attach the response body to the exception so callers can surface it
            raise requests.HTTPError(
                f"{response.status_code} {response.reason} — {response.text[:500]}",
                response=response,
            )

        return response.json()
