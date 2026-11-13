import base64
import datetime

import pymupdf as fitz
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID
from fastapi import HTTPException

from signatures import SignRequest, VerifyRequest, sign_bytes, verify_bytes


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def signing_material():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Folio test signer")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=30))
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=True, key_encipherment=False,
                                        data_encipherment=False, key_agreement=False, key_cert_sign=True,
                                        crl_sign=True, encipher_only=False, decipher_only=False), critical=True)
            .sign(key, hashes.SHA256()))
    archive = pkcs12.serialize_key_and_certificates(b"Folio", key, cert, None, serialization.BestAvailableEncryption(b"secret"))
    with fitz.open() as doc:
        doc.new_page().insert_text((50, 70), "Original content")
        data = doc.tobytes(deflate=False)
    return data, base64.b64encode(archive).decode(), cert.public_bytes(serialization.Encoding.PEM).decode()


@pytest.mark.anyio
async def test_sign_verify_trust_and_incremental_signatures(signing_material):
    original, archive, root = signing_material
    signed = await sign_bytes(original, SignRequest(pkcs12=archive, password="secret", fieldName="First"))
    assert signed.startswith(original)
    untrusted = (await verify_bytes(signed, VerifyRequest()))["signatures"][0]
    assert untrusted["intact"] and untrusted["valid"]
    assert not untrusted["trusted"]
    trusted = (await verify_bytes(signed, VerifyRequest(trustRoots=[root])))["signatures"][0]
    assert trusted["trusted"]
    second = await sign_bytes(signed, SignRequest(pkcs12=archive, password="secret", fieldName="Second"))
    assert second.startswith(signed)
    signatures = (await verify_bytes(second, VerifyRequest(trustRoots=[root])))["signatures"]
    assert len(signatures) == 2
    assert all(item["intact"] and item["valid"] for item in signatures)


@pytest.mark.anyio
async def test_crypto_tamper_detected_and_wrong_password(signing_material):
    original, archive, root = signing_material
    with pytest.raises(HTTPException):
        await sign_bytes(original, SignRequest(pkcs12=archive, password="wrong"))
    signed = await sign_bytes(original, SignRequest(pkcs12=archive, password="secret"))
    marker = b"4f726967696e616c"  # Original in the uncompressed text stream.
    assert marker in signed
    tampered = signed.replace(marker, b"416c746572656420", 1)
    results = await verify_bytes(tampered, VerifyRequest(trustRoots=[root]))
    assert not results["signatures"][0]["intact"]
