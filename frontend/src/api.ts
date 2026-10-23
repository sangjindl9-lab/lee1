import axios from 'axios'

export const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token')
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  return cfg
})
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && location.pathname !== '/login') {
      localStorage.removeItem('token')
      location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export function errMsg(e: any): string {
  const d = e?.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x: any) => x.msg).join(', ')
  return e?.message || '오류가 발생했습니다.'
}

export const fmt = (v: string | number | null | undefined, digits = 0): string => {
  if (v === null || v === undefined || v === '') return ''
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (Number.isNaN(n)) return String(v)
  return n.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}
export const fq = (v: string | number | null | undefined) => fmt(v, 3)
export const num = (v: string | null | undefined) => (v ? parseFloat(v) : 0)

export async function downloadFile(url: string, params?: Record<string, any>) {
  const r = await api.get(url, { params, responseType: 'blob' })
  const cd = r.headers['content-disposition'] || ''
  let name = 'download.xlsx'
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd) || /filename="?([^";]+)"?/.exec(cd)
  if (m) name = decodeURIComponent(m[1])
  const a = document.createElement('a')
  a.href = URL.createObjectURL(r.data)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

export const ROLE_LABELS: Record<string, string> = {
  cost_sheet: '원가계산서', summary: '총괄표/집계표', estimate: '공종별 내역서', change_estimate: '변경내역서',
  change_compare: '증감대비표', unit_price: '일위대가표', unit_price_index: '일위대가 목록', material_price: '자재단가/단가조사',
  labor_rate: '노임단가', quantity: '수량/공량 산출서', reference: '참조/기타', unknown: '미확인',
}
export const FIELD_LABELS: Record<string, string> = {
  work_code: '공종코드', item_code: '품목코드', code: '코드', name: '품명', spec: '규격', unit: '단위', qty: '수량',
  mat_price: '재료비 단가', mat_amt: '재료비 금액', lab_qty: '노무 수량', lab_price: '노무비 단가', lab_amt: '노무비 금액',
  exp_price: '경비 단가', exp_amt: '경비 금액', tot_price: '합계 단가', tot_amt: '합계 금액', price: '단가', amt: '금액', note: '비고', ref: '참조',
}

/** "30.0000" → "30", "404.5500" → "404.55" (입력창 표시용) */
export const trimNum = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined || v === '') return ''
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) ? String(n) : String(v)
}
