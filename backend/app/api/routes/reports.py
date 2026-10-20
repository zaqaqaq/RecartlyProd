"""Жалобы пользователей на контент.

Модераторы разбирают их в админке (`GET /admin/reports`), а здесь — публичный вход:
пожаловаться на рецепт, корзину, отзыв, комментарий или цену.
Без этого очередь жалоб в админке существовала, но наполнить её было нечем.
"""

from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_required
from app.core.database import get_db
from app.models.moderation import Report
from app.models.user import User
from app.schemas.report import REPORT_REASONS, ReportCreateIn, ReportOut

reports_router = APIRouter(prefix='/reports', tags=['Жалобы'])

# Простой антиспам: сколько жалоб пользователь может оставить за сутки
MAX_REPORTS_PER_DAY = 15


def _serialize(report: Report) -> ReportOut:
    data = ReportOut.model_validate(report)
    data.reason_label = REPORT_REASONS.get(report.reason_code)
    return data


@reports_router.get('/reasons')
def list_reasons():
    """Справочник причин жалобы — для выпадающего списка в интерфейсе."""
    return [{'code': code, 'label': label} for code, label in REPORT_REASONS.items()]


@reports_router.post('/', response_model=ReportOut)
def create_report(
    payload: ReportCreateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Отправить жалобу. Повторная жалоба на тот же объект не создаётся."""
    if payload.reason_code not in REPORT_REASONS:
        raise HTTPException(status_code=400, detail='Неизвестная причина жалобы')

    # Нельзя жаловаться на себя
    if payload.target_type == 'user' and payload.target_id == current_user.id:
        raise HTTPException(status_code=400, detail='Нельзя пожаловаться на себя')

    # Одна активная жалоба на объект от одного пользователя
    existing = (
        db.query(Report)
        .filter(
            Report.target_type == payload.target_type,
            Report.target_id == payload.target_id,
            Report.reporter_id == current_user.id,
            Report.status == 'open',
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail='Жалоба на этот объект уже отправлена')

    # Антиспам по частоте
    day_ago = datetime.utcnow() - timedelta(days=1)
    recent = (
        db.query(Report)
        .filter(Report.reporter_id == current_user.id, Report.created_at >= day_ago)
        .count()
    )
    if recent >= MAX_REPORTS_PER_DAY:
        raise HTTPException(
            status_code=429,
            detail='Слишком много жалоб за сутки. Попробуйте позже.',
        )

    report = Report(
        target_type=payload.target_type,
        target_id=payload.target_id,
        reporter_id=current_user.id,
        reason_code=payload.reason_code,
        comment=payload.comment,
        status='open',
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return _serialize(report)


@reports_router.get('/my', response_model=List[ReportOut])
def my_reports(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Мои жалобы и их статус — чтобы человек видел, что обращение не потерялось."""
    reports = (
        db.query(Report)
        .filter(Report.reporter_id == current_user.id)
        .order_by(Report.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_serialize(report) for report in reports]
