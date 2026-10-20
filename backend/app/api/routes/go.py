"""Партнёрские переходы в магазины: /go/{shop_id}.

Монетизация строится на CPA-ссылках, поэтому каждый переход фиксируется
в `purchase_clicks` (кто, из какого рецепта/сметы, в какой магазин), а пользователь
уходит по ссылке магазина. Нейтральность: наличие партнёрской программы не влияет
на цены и порядок выдачи — редирект используется только для перехода в магазин.
"""

from typing import Optional
from urllib.parse import quote_plus

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.basket import PurchaseClick
from app.models.geo import Shop
from app.models.user import User
from app.schemas.smeta import AffiliateLinkOut

go_router = APIRouter(prefix="/go", tags=["Партнёрские ссылки"])


def build_affiliate_url(shop: Shop, query: Optional[str] = None) -> Optional[str]:
    """Собирает ссылку магазина: шаблон партнёрки, иначе обычный поиск по сайту."""
    if shop.affiliate_template:
        return shop.affiliate_template.replace('{query}', quote_plus(query or ''))
    if shop.website:
        if query:
            return f'{shop.website.rstrip("/")}/search?q={quote_plus(query)}'
        return shop.website
    return None


@go_router.get('/link/{shop_id}', response_model=AffiliateLinkOut)
def affiliate_link(
    shop_id: int,
    query: Optional[str] = Query(None, description='Поисковый запрос, например название продукта'),
    db: Session = Depends(get_db),
):
    """Отдаёт ссылку на магазин без перехода (для кнопок «Купить в магазине»)."""
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if shop is None:
        raise HTTPException(status_code=404, detail='Магазин не найден')

    url = build_affiliate_url(shop, query)
    if url is None:
        raise HTTPException(status_code=404, detail='У магазина нет ссылки')

    return AffiliateLinkOut(
        shop_id=shop.id,
        shop_name=shop.name,
        url=url,
        is_partner=bool(shop.is_partner),
    )


@go_router.get('/{shop_id}')
def go_to_shop(
    shop_id: int,
    request: Request,
    query: Optional[str] = Query(None),
    recipe_id: Optional[int] = Query(None),
    basket_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Редирект в магазин с фиксацией клика (основа учёта комиссии)."""
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if shop is None:
        raise HTTPException(status_code=404, detail='Магазин не найден')

    url = build_affiliate_url(shop, query)
    if url is None:
        raise HTTPException(status_code=404, detail='У магазина нет ссылки')

    click = PurchaseClick(
        user_id=current_user.id if current_user else None,
        shop_id=shop.id,
        basket_id=basket_id,
        recipe_id=recipe_id,
        url=url,
        referer=request.headers.get('referer'),
        user_agent=request.headers.get('user-agent'),
    )
    db.add(click)
    db.commit()

    return RedirectResponse(url, status_code=302)
