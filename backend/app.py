"""Local-only UI comparison service. No screenshots or DOM are persisted here."""
import asyncio
import base64
import binascii
import io
import os
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel, Field, ConfigDict, model_validator
from backend.local_engine import analyze, visual_diff, ocr_engine, ENGINE

load_dotenv(Path(__file__).with_name('.env'))
Image.MAX_IMAGE_PIXELS = 24_000_000
app = FastAPI(title='project-1 local comparison service')
gate = asyncio.Semaphore(1)


@app.middleware('http')
async def local_boundary(request: Request, call_next):
    origin = request.headers.get('origin', '')
    extension_id = os.getenv('EXTENSION_ID', '')
    allowed = f'chrome-extension://{extension_id}' if extension_id else ''
    # Only the configured extension can submit or read local captures.
    if request.url.path != '/health' and (not allowed or origin != allowed):
        return JSONResponse({'detail': 'Set EXTENSION_ID in backend/.env to the installed extension ID.'}, status_code=403)
    if request.headers.get('host', '') not in ('127.0.0.1:8765', 'localhost:8765', 'testserver'):
        return JSONResponse({'detail': 'Invalid host.'}, status_code=403)
    if request.method == 'OPTIONS':
        response = JSONResponse({})
    else:
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 25_000_000:
                return JSONResponse({'detail': 'Request exceeds 25 MB.'}, status_code=413)
        request._body = bytes(body)
        response = await call_next(request)
    if allowed and origin == allowed:
        response.headers['Access-Control-Allow-Origin'] = allowed
        response.headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        response.headers['Vary'] = 'Origin'
    return response


class Box(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode='after')
    def contained(self):
        if self.x + self.width > 1.001 or self.y + self.height > 1.001:
            raise ValueError('Annotation must fit inside the viewport.')
        return self


class Element(BaseModel):
    tag: str = Field(max_length=30)
    text: str = Field(max_length=140)
    box: Box
    fontSize: str = Field(max_length=100)
    fontFamily: str = Field(max_length=300)
    color: str = Field(max_length=100)
    background: str = Field(max_length=100)
    display: str = Field(max_length=100)
    gap: str = Field(max_length=100)
    padding: str = Field(max_length=100)


class Snapshot(BaseModel):
    url: str = Field(max_length=4096)
    title: str = Field(max_length=1000)
    width: int = Field(gt=0, le=12000)
    height: int = Field(gt=0, le=12000)
    dpr: float = Field(gt=0, le=10)
    scrollX: float
    scrollY: float
    elements: list[Element] = Field(max_length=350)


class CompareRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    design: str = Field(max_length=12_000_000)
    actual: str = Field(max_length=12_000_000)
    snapshot: Snapshot


class Finding(BaseModel):
    title: str = Field(max_length=150)
    category: Literal['missing', 'text', 'layout', 'spacing', 'style']
    severity: Literal['high', 'medium', 'low']
    confidence: float = Field(ge=0, le=1)
    expected: str = Field(max_length=1000)
    actual: str = Field(max_length=1000)
    explanation: str = Field(max_length=1500)
    recommendation: str = Field(max_length=1000)
    annotation: Literal['rectangle', 'arrow', 'triangle', 'measurement']
    box: Box
    basis: Literal['measured', 'possible'] = 'possible'


class Analysis(BaseModel):
    summary: str = Field(max_length=2000)
    issues: list[Finding] = Field(max_length=40)


def decode_image(data: str) -> Image.Image:
    if not data.startswith(('data:image/png;base64,', 'data:image/jpeg;base64,')):
        raise HTTPException(422, 'Expected a PNG or JPEG image.')
    try:
        raw = base64.b64decode(data.split(',', 1)[1], validate=True)
        with Image.open(io.BytesIO(raw)) as image:
            if image.width * image.height > 24_000_000 or max(image.size) > 12000:
                raise ValueError('Image is too large.')
            image.load()
            return image.convert('RGB')
    except (ValueError, OSError, binascii.Error, Image.DecompressionBombError) as error:
        raise HTTPException(422, 'Invalid image or image exceeds 24 megapixels.') from error


@app.get('/health')
async def health():
    try:
        await asyncio.to_thread(ocr_engine)
        ready = True
    except Exception:
        ready = False
    return {'ok': True, 'configured': ready, 'ocrReady': ready,
            'extensionConfigured': bool(os.getenv('EXTENSION_ID')), 'engine': ENGINE,
            'externalServices': False}


@app.post('/compare')
async def compare(payload: CompareRequest):
    if gate.locked():
        raise HTTPException(429, 'A local comparison is already running. Try again shortly.')
    async with gate:
        design, actual = await asyncio.to_thread(lambda: (decode_image(payload.design), decode_image(payload.actual)))
        if abs((actual.width / actual.height) / (payload.snapshot.width / payload.snapshot.height) - 1) > .03:
            raise HTTPException(422, 'Capture dimensions do not match the inspected viewport. Recapture.')
        try:
            result = await asyncio.to_thread(analyze, design, actual, payload.snapshot.model_dump())
            validated = Analysis.model_validate(result)
            return {**result, **validated.model_dump()}
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(503, 'Local OCR/comparison failed. Install backend/requirements.txt with Python 3.11 or 3.12 and restart the service.') from error
