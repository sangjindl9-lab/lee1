from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    is_active: bool


class UserIn(BaseModel):
    username: str
    password: str
    display_name: str = ""
    role: str = "user"


class ProjectIn(BaseModel):
    name: str
    client: str = ""
    contractor: str = ""
    work_type: str = "전기"
    contract_type: str = "국가계약"
    contract_amount: float | None = None
    start_date: str | None = None
    end_date: str | None = None
    rounding: dict | None = None
    settings: dict | None = None


class MemberIn(BaseModel):
    user_id: int
    access: str = "edit"


class SheetUpdate(BaseModel):
    user_role: str | None = None
    user_column_map: dict[str, int | None] | None = None
    save_as_rule: bool = False


class ImportIn(BaseModel):
    label: str = "최초계약"
    include_sheets: list[str] | None = None
    version_no: int | None = None


class ClaimIn(BaseModel):
    claim_no: int | None = None
    title: str = ""
    base_date: str | None = None
    is_final: bool = False
    is_adjustment: bool = False
    input_mode: str = "qty"
    memo: str = ""
    contract_version_id: int | None = None


class ClaimInputs(BaseModel):
    inputs: dict[str, dict[str, Any]] = Field(default_factory=dict)


class ItemEdit(BaseModel):
    qty: float | None = None
    mat_price: float | None = None
    lab_price: float | None = None
    exp_price: float | None = None
    name: str | None = None
    spec: str | None = None
    unit: str | None = None
    note: str | None = None
    reason: str = ""


class ItemAdd(BaseModel):
    section_path: list[str] | None = None
    after_uid: str | None = None
    name: str
    spec: str = ""
    unit: str = ""
    qty: float = 0
    mat_price: float = 0
    lab_price: float = 0
    exp_price: float = 0
    note: str = ""
    reason: str = ""


class PriceAdjustIn(BaseModel):
    mat_pct: float = 100      # 재료비 단가 적용률(%) — 100 이면 변동 없음
    lab_pct: float = 100      # 노무비 단가 적용률(%)
    exp_pct: float = 100      # 경비 단가 적용률(%)
    section_prefix: list[str] | None = None   # 특정 공종(경로 prefix)만
    price_digits: int = 0     # 조정 단가 소수 자리 (절사)
    price_round: str = "trunc"   # trunc / round
    only_preview: bool = False
    reason: str = ""


class CostRuleIn(BaseModel):
    rate: float | None = None
    rate_base: str | None = None
    fixed: bool | None = None
    source: str | None = None
    effective_date: str | None = None
    amount: float | None = None


class ChangeIn(BaseModel):
    title: str = ""
    reason: str = ""
    base_version_id: int | None = None
    price_rule: str = "contract"
    applied_date: str | None = None


class ChangeItemIn(BaseModel):
    uid: str | None = None
    action: str = "modify"        # modify / add / delete / spec_change
    new_qty: float | None = None
    new_mat_price: float | None = None
    new_lab_price: float | None = None
    new_exp_price: float | None = None
    price_type: str = "contract"
    price_basis: str = ""
    reason: str = ""
    new_item: dict | None = None   # add: {section_path, name, spec, unit, unit_price_ref, after_uid}
