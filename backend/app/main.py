from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.dataset import load


@asynccontextmanager
async def lifespan(app: FastAPI):
    load()  # падаем на старте, если датасет битый
    yield


app = FastAPI(title="Voice Router", lifespan=lifespan)


@app.get("/health")
def health():
    ds = load()
    return {
        "status": "ok",
        "scenarios": len(ds.scenarios),
        "slots": len(ds.slots),
        "actions": len(ds.actions),
        "clients": len(ds.backend.clients),
    }
