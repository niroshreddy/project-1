"""Bounded checkout recovery contracts. Model output never supplies executable actions."""
from typing import Literal
from urllib.parse import urlsplit, urlunsplit
import os
from pydantic import BaseModel, Field, ConfigDict, model_validator

SCENARIOS = ('invalid-postal','empty-postal','keyboard-invalid-postal')
class FieldValue(BaseModel):
    model_config=ConfigDict(extra='forbid')
    selector: str = Field(min_length=1,max_length=200)
    value: str = Field(max_length=160)
    label: str = Field(default='',max_length=100)
class Viewport(BaseModel):
    width: int = Field(ge=320,le=1920)
    height: int = Field(default=800,ge=480,le=1200)
class DiscoverRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    url: str = Field(min_length=1,max_length=2048)
    formSelector: str = Field(default='form',min_length=1,max_length=200)
class JourneyContract(DiscoverRequest):
    submitSelector: str = Field(default='button[type="submit"]',min_length=1,max_length=200)
    postalSelector: str = Field(min_length=1,max_length=200)
    successSelector: str = Field(min_length=1,max_length=200)
    errorSelector: str = Field(default='[role="alert"], [aria-live], .error, [data-error]',min_length=1,max_length=200)
    fields: list[FieldValue] = Field(min_length=1,max_length=15)
    validPostal: str = Field(default='78701',min_length=1,max_length=32)
    invalidPostal: str = Field(default='INVALID!',min_length=1,max_length=32)
    viewports: list[Viewport] = Field(default_factory=lambda:[Viewport(width=390),Viewport(width=1280)],min_length=1,max_length=2)
    repeats: int = Field(default=2,ge=2,le=3)
    build: str = Field(min_length=1,max_length=120)
    goal: str = Field(default='Correct an invalid postal code without losing other address fields and continue to shipping options.',max_length=500)
    allowedWritePaths: list[str] = Field(default_factory=list,max_length=6)
    useLocalAI: bool = False
    model: str = Field(default='',max_length=100)
    stagingConfirmed: Literal[True]
    @model_validator(mode='after')
    def consistent(self):
        if self.validPostal==self.invalidPostal: raise ValueError('Valid and invalid postal codes must differ.')
        if len({field.selector for field in self.fields})!=len(self.fields): raise ValueError('Field selectors must be unique.')
        if len({(size.width,size.height) for size in self.viewports})!=len(self.viewports): raise ValueError('Viewport sizes must be unique.')
        if any(not path.startswith('/') or '?' in path or '#' in path or '*' in path for path in self.allowedWritePaths): raise ValueError('Write paths must be exact URL paths, starting with /.')
        return self
class LocalPlan(BaseModel):
    model_config=ConfigDict(extra='forbid')
    scenarios: list[Literal['invalid-postal','empty-postal','keyboard-invalid-postal']] = Field(min_length=1,max_length=3)
    rationale: str = Field(max_length=600)
    hypotheses: list[str] = Field(default_factory=list,max_length=4)
class VerifyRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    url: str = Field(min_length=1,max_length=2048)
    build: str = Field(min_length=1,max_length=120)
    stagingConfirmed: Literal[True]
class ReviewRequest(BaseModel):
    reviewer: str = Field(min_length=1,max_length=120)
    outcome: Literal['confirmed-issue','verified-fixed','still-present','unable-to-verify']
    note: str = Field(default='',max_length=2000)

def origin(url):
    parsed=urlsplit(url)
    if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Use an HTTP/HTTPS staging URL without credentials, query parameters or fragments.')
    # Exact origin matching, including port. No wildcard targets or cloud metadata endpoint.
    if parsed.hostname in ('169.254.169.254','metadata.google.internal'): raise ValueError('This target is not permitted.')
    return f'{parsed.scheme}://{parsed.netloc.lower()}'

def allowed_origins():
    configured=os.getenv('JOURNEY_ALLOWED_ORIGINS','http://127.0.0.1:8765')
    return {origin(value.strip().rstrip('/')) for value in configured.split(',') if value.strip()}

def validate_target(url):
    target=origin(url)
    if target not in allowed_origins(): raise ValueError('Target origin is not enabled. Add the exact staging origin to JOURNEY_ALLOWED_ORIGINS in backend/.env and restart.')
    return target
