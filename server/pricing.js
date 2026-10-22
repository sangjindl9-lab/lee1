import { config } from './config.js';
import { bad, todayKST, daysBetween, isDate } from './util.js';

// 요금은 항상 서버에서 계산한다 (화면에서 보낸 금액은 믿지 않음)
export function quote(listing, checkIn, checkOut, guests) {
  if (!isDate(checkIn) || !isDate(checkOut)) throw bad('날짜 형식이 올바르지 않아요.');
  if (checkIn < todayKST()) throw bad('지난 날짜는 예약할 수 없어요.');
  if (checkIn > todayKST(365)) throw bad('1년 이내 날짜만 예약할 수 있어요.');
  const nights = daysBetween(checkIn, checkOut);
  if (nights < 1) throw bad('체크아웃은 체크인 다음 날 이후여야 해요.');
  if (nights > 30) throw bad('한 번에 최대 30박까지 예약할 수 있어요.');
  if (nights < listing.min_nights) throw bad(`이 숙소는 최소 ${listing.min_nights}박부터 예약할 수 있어요.`);
  if (!Number.isInteger(guests) || guests < 1) throw bad('인원을 확인해 주세요.');
  if (guests > listing.max_guests) throw bad(`이 숙소는 최대 ${listing.max_guests}명까지 머물 수 있어요.`);
  const nightly = listing.price;
  const subtotal = nightly * nights;
  const cleaning = listing.cleaning_fee;
  const serviceFee = Math.round((subtotal + cleaning) * config.serviceFeeRate);
  const hostFee = Math.round((subtotal + cleaning) * config.hostFeeRate);
  return {
    nights, nightly, subtotal, cleaningFee: cleaning, serviceFee,
    total: subtotal + cleaning + serviceFee,
    hostFee, hostPayout: subtotal + cleaning - hostFee,
    serviceFeeRate: config.serviceFeeRate,
  };
}
