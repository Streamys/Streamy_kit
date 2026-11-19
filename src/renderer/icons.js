// Streamy Kit — 소스 종류 플랫 아이콘 (직접 그린 SVG, 48x48)
'use strict';
const S = (body) => `<svg class="fi" viewBox="0 0 48 48" aria-hidden="true">${body}</svg>`;
const FLAT_ICONS = {
  // 모니터 화면
  monitor: S(`<rect x="4" y="7" width="40" height="27" rx="5" fill="#4C8DF6"/><rect x="8" y="11" width="32" height="19" rx="2.5" fill="#BFE0FF"/>
    <path d="M8 26l8-7 6 5 7-8 11 10v1.5a2.5 2.5 0 0 1-2.5 2.5h-27A2.5 2.5 0 0 1 8 27.5z" fill="#7FB8FF"/>
    <rect x="21" y="34" width="6" height="6" fill="#3570D4"/><rect x="14" y="39" width="20" height="4" rx="2" fill="#2B5DB8"/>`),
  // 프로그램 창
  window: S(`<rect x="4" y="7" width="40" height="34" rx="6" fill="#FFFFFF" stroke="#D5DBE6" stroke-width="2"/>
    <path d="M4 13a6 6 0 0 1 6-6h28a6 6 0 0 1 6 6v3H4z" fill="#8B7CF6"/>
    <circle cx="10" cy="11.5" r="1.8" fill="#FF6B7A"/><circle cx="15.5" cy="11.5" r="1.8" fill="#FFC44D"/><circle cx="21" cy="11.5" r="1.8" fill="#4ED69A"/>
    <rect x="9" y="21" width="18" height="3.5" rx="1.75" fill="#D9D3FB"/><rect x="9" y="28" width="30" height="3.5" rx="1.75" fill="#EAE6FD"/><rect x="9" y="34" width="22" height="3.5" rx="1.75" fill="#EAE6FD"/>`),
  // 게임
  game: S(`<path d="M14 13h20c6 0 10 4.5 10.5 10.5l1 9.5c.5 4.5-4.5 7-7.5 3.5l-4-4.5H14l-4 4.5c-3 3.5-8 1-7.5-3.5l1-9.5C4 17.5 8 13 14 13z" fill="#9B6BF2"/>
    <rect x="11" y="20.5" width="10" height="3.5" rx="1.75" fill="#fff"/><rect x="14.25" y="17.25" width="3.5" height="10" rx="1.75" fill="#fff"/>
    <circle cx="32" cy="19.5" r="2.4" fill="#FFD166"/><circle cx="37" cy="24" r="2.4" fill="#4ED69A"/><circle cx="32" cy="28.5" r="2.4" fill="#FF6B7A"/><circle cx="27" cy="24" r="2.4" fill="#5CC8FF"/>`),
  // 웹캠
  webcam: S(`<circle cx="24" cy="20" r="15" fill="#3C4558"/><circle cx="24" cy="20" r="10" fill="#1E2433"/><circle cx="24" cy="20" r="6" fill="#4C8DF6"/>
    <circle cx="21.5" cy="17.5" r="2" fill="#CFE6FF"/><circle cx="35" cy="10" r="2" fill="#FF5A6E"/>
    <path d="M16 35h16l3 6H13z" fill="#5A647A"/><rect x="11" y="40" width="26" height="4" rx="2" fill="#3C4558"/>`),
  // 이미지
  image: S(`<rect x="4" y="8" width="40" height="32" rx="6" fill="#FFB547"/><rect x="8" y="12" width="32" height="24" rx="3" fill="#FFF3D6"/>
    <circle cx="31" cy="19" r="3.5" fill="#FF8A3D"/><path d="M8 32l9-10 7 7 5-4 11 9v-.5A2.5 2.5 0 0 1 37.5 36h-27A2.5 2.5 0 0 1 8 33.5z" fill="#4ED69A"/>
    <path d="M8 33.5l9-10 7 7" fill="none"/>`),
  // 텍스트
  text: S(`<rect x="5" y="5" width="38" height="38" rx="10" fill="#FF7A9C"/>
    <path d="M14 15h20v5.5h-3.5V18.5H26V33h3v4H19v-4h3V18.5h-4.5V20.5H14z" fill="#fff"/>`),
  // 웹페이지 (알림창)
  web: S(`<circle cx="24" cy="24" r="19" fill="#22B8CF"/><path d="M5.5 22h37M5.5 27h37" stroke="#BDF1F8" stroke-width="2.5"/>
    <ellipse cx="24" cy="24" rx="8.5" ry="19" fill="none" stroke="#BDF1F8" stroke-width="2.5"/><path d="M24 5v38" stroke="#BDF1F8" stroke-width="2.5"/>
    <circle cx="37" cy="11" r="6" fill="#FF5A6E"/><path d="M37 8v3.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="37" cy="13.8" r="1.1" fill="#fff"/>`),
  // 타이머
  timer: S(`<rect x="19" y="3" width="10" height="5" rx="2.5" fill="#FF8A3D"/><path d="M24 8v4" stroke="#FF8A3D" stroke-width="3"/>
    <circle cx="24" cy="27" r="17" fill="#FF8A3D"/><circle cx="24" cy="27" r="13" fill="#FFF1E6"/>
    <path d="M24 27V18" stroke="#3C4558" stroke-width="3" stroke-linecap="round"/><path d="M24 27l6 4" stroke="#FF5A6E" stroke-width="3" stroke-linecap="round"/>
    <circle cx="24" cy="27" r="2.5" fill="#3C4558"/><path d="M37 12l3-3" stroke="#FF8A3D" stroke-width="3" stroke-linecap="round"/>`),
  // 버추얼
  virtual: S(`<circle cx="12" cy="12" r="7" fill="#E89A6B"/><circle cx="36" cy="12" r="7" fill="#E89A6B"/><circle cx="12" cy="12" r="3.5" fill="#FFC9A8"/><circle cx="36" cy="12" r="3.5" fill="#FFC9A8"/>
    <circle cx="24" cy="26" r="17" fill="#F2AE80"/><ellipse cx="24" cy="32" rx="8" ry="6" fill="#FFE1CC"/>
    <circle cx="17.5" cy="23" r="2.4" fill="#3C2A22"/><circle cx="30.5" cy="23" r="2.4" fill="#3C2A22"/><ellipse cx="24" cy="29.5" rx="2.6" ry="2" fill="#3C2A22"/>
    <circle cx="13" cy="29" r="2.6" fill="#FF8FA3" opacity=".7"/><circle cx="35" cy="29" r="2.6" fill="#FF8FA3" opacity=".7"/>`),
  // 단색 배경
  color: S(`<path d="M24 5c10.5 0 19 7.6 19 17 0 5.5-4.2 8.5-8.5 8.5h-4.2c-2.3 0-3.7 2.4-2.6 4.4l.6 1.1c1.5 2.8-.4 7-4.3 7C13.5 43 5 34.5 5 24S13.5 5 24 5z" fill="#FFD166"/>
    <circle cx="15" cy="20" r="3.4" fill="#FF5A6E"/><circle cx="22" cy="13" r="3.4" fill="#4C8DF6"/><circle cx="31" cy="14" r="3.4" fill="#4ED69A"/><circle cx="14" cy="30" r="3.4" fill="#9B6BF2"/>`),
};
module.exports = { FLAT_ICONS };
