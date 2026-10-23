from pydantic import BaseModel, EmailStr, Field


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class RegisterIn(BaseModel):
    company_name: str
    email: EmailStr
    name: str
    password: str = Field(min_length=8)


class ProjectIn(BaseModel):
    name: str | None = None
    client: str | None = None
    location: str | None = None
    work_type: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    author: str | None = None
    reviewer: str | None = None
    takeoff_settings: dict | None = None


class SheetMetaIn(BaseModel):
    drawing_no: str | None = None
    drawing_title: str | None = None
    drawing_type: str | None = None
    discipline: str | None = None
    floor_zone: str | None = None


class ScaleIn(BaseModel):
    """축척 확정: scale_factor(도면단위→m) 직접 입력 또는 기준거리(두 점 + 실제 m)."""
    scale_factor: float | None = None
    ref_points: list[list[float]] | None = None
    ref_length_m: float | None = None
    units: str | None = None


class LegendRegionIn(BaseModel):
    sheet_id: int
    region: dict  # {x0,y0,x1,y1}
    title: str | None = None


class LegendSymbolIn(BaseModel):
    symbol_name: str | None = None
    block_name: str | None = None
    item_name: str | None = None
    spec: str | None = None
    unit: str | None = None
    discipline: str | None = None
    category: str | None = None
    layer_hint: str | None = None
    status: str | None = None
    extra: dict | None = None
    save_to_library: bool = False


class DetectedSymbolIn(BaseModel):
    legend_symbol_id: int | None = None
    status: str | None = None
    install_type: str | None = None
    floor_zone: str | None = None
    note: str | None = None


class ManualSymbolIn(BaseModel):
    sheet_id: int
    legend_symbol_id: int
    x: float
    y: float
    floor_zone: str | None = None
    note: str | None = None


class CircuitIn(BaseModel):
    route_id: int
    cable_symbol_id: int
    circuit_count: int = Field(ge=1)
    confirmed: bool = True
    note: str | None = None


class RouteIn(BaseModel):
    vertical_m: float | None = None
    slack_m: float | None = None
    status: str | None = None
    legend_symbol_id: int | None = None


class QuantityItemIn(BaseModel):
    qty_total: float | None = None
    qty_vertical: float | None = None
    qty_slack: float | None = None
    qty_markup: float | None = None
    status: str | None = None
    note: str | None = None
    floor_zone: str | None = None
