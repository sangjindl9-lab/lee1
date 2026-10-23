"""KET_JOB_BACKEND=celery 일 때 사용하는 분산 작업 큐 (Redis 브로커)."""
from celery import Celery

from .config import settings

celery = Celery("ket", broker=settings.redis_url, backend=settings.redis_url)
celery.conf.task_serializer = "json"


@celery.task(name="ket.process_file")
def process_file_task(file_id: int):
    from .jobs import process_file
    process_file(file_id)
