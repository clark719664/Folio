"""In-memory certificate signing and offline signature verification."""
import base64
import io
import uuid

import pymupdf as fitz
from fastapi import HTTPException
from pydantic import BaseModel, Field, SecretStr
from asn1crypto import pem, x509
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign import signers
from pyhanko.sign.fields import SigFieldSpec, MDPPerm
from pyhanko.sign.validation import async_validate_pdf_signature
from pyhanko_certvalidator import ValidationContext


class SignRequest(BaseModel):
    pkcs12: SecretStr
    password: SecretStr = SecretStr("")
    fieldName: str = Field(default="Signature", min_length=1, max_length=150)
    reason: str = ""
    location: str = ""
    certify: bool = False
    allowedChanges: str = "forms"


class VerifyRequest(BaseModel):
    trustRoots: list[str] = Field(default_factory=list)


async def sign_bytes(data: bytes, request: SignRequest) -> bytes:
    if len(request.pkcs12.get_secret_value()) > 4_000_000:
        raise HTTPException(413, "Certificate archive is too large")
    try:
        archive = base64.b64decode(request.pkcs12.get_secret_value(), validate=True)
        signer = signers.SimpleSigner.load_pkcs12_data(archive, other_certs=[], passphrase=request.password.get_secret_value().encode() or None)
    except Exception as exc:
        raise HTTPException(422, "Certificate archive or password is invalid") from exc
    if signer is None:
        raise HTTPException(422, "Certificate archive does not contain a signing key")
    permissions = {"none": MDPPerm.NO_CHANGES, "forms": MDPPerm.FILL_FORMS, "annotations": MDPPerm.ANNOTATE}
    if request.allowedChanges not in permissions:
        raise HTTPException(422, "Choose none, forms or annotations for allowed changes")
    try:
        writer = IncrementalPdfFileWriter(io.BytesIO(data))
        metadata = signers.PdfSignatureMetadata(field_name=request.fieldName, md_algorithm="sha256", reason=request.reason,
                                                location=request.location, certify=request.certify,
                                                docmdp_permissions=permissions[request.allowedChanges])
        output = io.BytesIO()
        await signers.PdfSigner(metadata, signer=signer, new_field_spec=SigFieldSpec(request.fieldName)).async_sign_pdf(writer, output=output)
        return output.getvalue()
    except Exception as exc:
        raise HTTPException(422, "Could not sign this document. Check the field name and existing certification restrictions") from exc


async def verify_bytes(data: bytes, request: VerifyRequest):
    roots = []
    try:
        for encoded in request.trustRoots:
            data_root = encoded.encode() if encoded.startswith("-----BEGIN") else base64.b64decode(encoded, validate=True)
            if pem.detect(data_root):
                _, _, data_root = pem.unarmor(data_root)
            roots.append(x509.Certificate.load(data_root))
        reader = PdfFileReader(io.BytesIO(data))
        embedded = reader.embedded_signatures
    except Exception as exc:
        raise HTTPException(422, "Could not read signatures or supplied trust roots") from exc
    signatures = []
    for signature in embedded:
        try:
            context = ValidationContext(trust_roots=roots, allow_fetching=False, revocation_mode="soft-fail")
            status = await async_validate_pdf_signature(signature, signer_validation_context=context)
            signatures.append({"fieldName": signature.field_name, "signer": signature.signer_cert.subject.human_friendly,
                               "intact": status.intact, "valid": status.valid, "trusted": status.trusted,
                               "coverage": status.coverage.name if status.coverage else None,
                               "modificationLevel": status.modification_level.name if status.modification_level else None,
                               "certificationSatisfied": status.docmdp_ok, "summary": status.summary()})
        except Exception:
            signatures.append({"fieldName": signature.field_name, "intact": False, "valid": False,
                               "trusted": False, "error": "Signature validation failed"})
    return {"signatures": signatures, "validationMode": "offline", "trustSource": "provided-roots" if roots else "no-trusted-roots",
            "revocationChecked": False, "timestampServiceUsed": False}


def register(app, location, describe):
    @app.post("/api/documents/{document_id}/signatures")
    async def sign_document(document_id: str, request: SignRequest):
        source = location(document_id)
        data = await sign_bytes(source.read_bytes(), request)
        new_id = uuid.uuid4().hex
        with fitz.open(stream=data, filetype="pdf") as doc:
            result = describe(new_id, doc, "Signed.pdf")
        temporary = source.parent / f"{new_id}.tmp"
        temporary.write_bytes(data)
        temporary.replace(source.parent / f"{new_id}.pdf")
        (source.parent / f"{new_id}.name").write_text("Signed.pdf", encoding="utf-8")
        try:
            from .library import record_revision, document_name
        except ImportError:
            from library import record_revision, document_name
        record_revision(source.parent, new_id, "Signed.pdf", document_id)
        result["name"] = document_name(source.parent, new_id) or "Signed.pdf"
        return result

    @app.post("/api/documents/{document_id}/signatures/verify")
    async def verify_document(document_id: str, request: VerifyRequest):
        return await verify_bytes(location(document_id).read_bytes(), request)
