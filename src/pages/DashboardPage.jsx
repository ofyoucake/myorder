import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { OrderCard } from '../components/OrderCard';
import { supabase } from '../supabaseClient';
import Papa from 'papaparse';

const KST_TIME_ZONE = 'Asia/Seoul';

const getKSTDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: KST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}.${values.month}.${values.day}`;
};

const normalizeDateKey = (dateKey) => {
  if (!dateKey) return '';
  const parts = dateKey.replace(/-/g, '.').split('.');
  if (parts.length !== 3) return dateKey;
  return parts.map(part => part.padStart(2, '0')).join('.');
};

const compareDateKeys = (left, right) => {
  const normalizedLeft = normalizeDateKey(left);
  const normalizedRight = normalizeDateKey(right);
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft < normalizedRight ? -1 : 1;
};

const getCalendarDateFromKey = (dateKey) => {
  const [year, month, day] = normalizeDateKey(dateKey).split('.').map(Number);
  return new Date(year, month - 1, day);
};

const DashboardPage = ({ session, onLogout }) => {
  // 1. State Management
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [activeTab, setActiveTab] = useState('day');
  
  // Calendar View State
  const [viewDate, setViewDate] = useState(() => getCalendarDateFromKey(getKSTDateKey()));
  
  // Date Selection for Dashboard
  const [selectedDate, setSelectedDate] = useState(() => getKSTDateKey()); // yyyy.mm.dd, KST
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);

  // Date Selection for Statistics
  const [statsStartDate, setStatsStartDate] = useState(null);
  const [statsEndDate, setStatsEndDate] = useState(null);
  const [showStatsDatePicker, setShowStatsDatePicker] = useState(false);

  // Filter State
  const [filters, setFilters] = useState({ design: [], sheet: [], cream: [], flavor: [], size: [] });
  const [showFilterPicker, setShowFilterPicker] = useState(false);
  const [expandedFilters, setExpandedFilters] = useState({});

  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [copiedType, setCopiedType] = useState(null);

  // Database Sync
  const [sheetInfo, setSheetInfo] = useState('');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  const filterRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (filterRef.current && !filterRef.current.contains(event.target) && !event.target.closest('.filter-toggle-btn')) {
        setShowFilterPicker(false);
      }
    };
    if (showFilterPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showFilterPicker]);

  const menuItems = [
    { id: 'dashboard', label: '대시보드' },
    { id: 'statistics', label: '통계 분석' },
    { id: 'mypage', label: '마이페이지' },
  ];

  // Load profile
  useEffect(() => {
    const fetchProfile = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('sheet_url')
        .eq('id', session.user.id)
        .single();
      if (data?.sheet_url) setSheetInfo(data.sheet_url);
    };
    fetchProfile();
  }, [session.user.id]);

  const handleSaveSheetInfo = async (url) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: session.user.id, sheet_url: url, updated_at: new Date().toISOString() });
      if (error) throw error;
      setSheetInfo(url);
      alert('설정이 안전하게 저장되었습니다!');
    } catch (err) { alert('저장 실패: ' + err.message); }
    finally { setLoading(false); }
  };

  const loadSheetData = useCallback(async (info) => {
    if (!info) return;
    setLoading(true);
    try {
      let sheetId = info;
      if (info.includes('/d/')) sheetId = info.split('/d/')[1].split('/')[0];
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
      const response = await fetch(csvUrl);
      const csvText = await response.text();
      
      // Use header: false to handle the empty column M header issue
      Papa.parse(csvText, {
        header: false,
        skipEmptyLines: true,
        complete: (results) => {
          // Skip the first header row
          const dataRows = results.data.slice(1);
          const mapped = dataRows.map((row, index) => {
            const pickupDateRaw = row[3] || ''; // Column D
            const [dPart, tPart] = pickupDateRaw.includes(' ') ? pickupDateRaw.split(' ') : [pickupDateRaw, '00:00'];
            
            // Normalize date string to yyyy.mm.dd (handle 2026.5.8 -> 2026.05.08)
            const normalizedDate = normalizeDateKey(dPart);

            return {
              id: `sheet-${index}`,
              customer: row[0] || '미지명', // A
              design: (row[1] || '-').replace(/\s+/g, ''), // B
              orderDate: row[2] || '-', // C
              pickupDate: pickupDateRaw, // D
              time: tPart || '00:00',
              dateOnly: normalizedDate,
              flavor: (row[4] || '-').replace(/\s+/g, ''), // E
              sheet: (row[5] || '-').replace(/\s+/g, ''), // F
              size: (row[6] || '-').replace(/\s+/g, ''), // G
              cream: (row[7] || '-').replace(/\s+/g, ''), // H
              requests: row[8] || '-', // I
              specialNotes: row[9] || '-', // J
              orderPath: row[10] || '-', // K
              contact: row[11] || '-', // L
              price: parseInt((row[12] || '0').replace(/[^0-9]/g, '')) || 0, // M
            };
          });
          setOrders(mapped);
          setLoading(false);
        }
      });
    } catch (e) { setLoading(false); }
  }, []);

  useEffect(() => { loadSheetData(sheetInfo); }, [sheetInfo, loadSheetData]);

  const handleOrderClick = (order) => { 
    setSelectedOrder(order); 
    setShowDetailModal(true);
    setCopiedType(null);
  };

  // ─── 메시지 복사 헬퍼 함수 ───────────────────────────────────────

  // 고객명에서 성(첫 글자) 제거
  const getFirstName = (customer) => customer ? customer.slice(1) : '';

  // 픽업일시 포맷: "2026.08.06 17:00" → "8월 06일 목요일 17시" (00분이면 분 생략)
  const formatPickupDateTime = (pickupDateRaw) => {
    if (!pickupDateRaw) return '';
    const parts = pickupDateRaw.split(' ');
    const datePart = parts[0] || '';
    const timePart = parts[1] || '00:00';
    const [y, m, d] = datePart.split('.').map(Number);
    const [h, min] = timePart.split(':').map(Number);
    if (!y || !m || !d) return pickupDateRaw;
    const date = new Date(y, m - 1, d);
    const weekdays = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    const dayName = weekdays[date.getDay()];
    const minPart = min === 0 ? '' : ` ${String(min).padStart(2, '0')}분`;
    return `${m}월 ${String(d).padStart(2, '0')}일 ${dayName} ${h}시${minPart}`;
  };

  // 픽업가능시간: ±30분 범위 (00분이면 분 생략)
  const formatPickupRange = (pickupDateRaw) => {
    if (!pickupDateRaw) return '';
    const parts = pickupDateRaw.split(' ');
    const datePart = parts[0] || '';
    const timePart = parts[1] || '00:00';
    const [y, m, d] = datePart.split('.').map(Number);
    const [h, min] = timePart.split(':').map(Number);
    if (!y || !m || !d) return '';
    const totalMinutes = h * 60 + min;
    const fmt = (totalMin) => {
      const hh = Math.floor(totalMin / 60);
      const mm = totalMin % 60;
      return mm === 0 ? `${hh}시` : `${hh}시 ${String(mm).padStart(2, '0')}분`;
    };
    return `${m}월 ${String(d).padStart(2, '0')}일 ${fmt(totalMinutes - 30)} ~ ${fmt(totalMinutes + 30)}`;
  };

  // 메시지 생성
  const generateMessage = (type, order) => {
    const firstName = getFirstName(order.customer);
    const pickupDateTime = formatPickupDateTime(order.pickupDate);
    const pickupRange = formatPickupRange(order.pickupDate);
    const requestsText = [order.requests, order.specialNotes]
      .filter(v => v && v !== '-')
      .join(' / ') || '-';

    if (type === 'order') {
      return ` [OF YOU 케이크 주문서]
케이크 주문을 원하실 경우, 아래 양식에 맞춰 회신 부탁드립니다 :)

1. 성함/ 연락처: 
2. 픽업 날짜 / 시간:
3. 케이크 디자인: 
4. 원하시는 맛: 
5. 요청사항: .

답변 확인 후 예약 가능 여부 및 입금 안내를 순차적으로 드리겠습니다.`;
    }

    if (type === 'reservation') {
      return `[OF YOU 예약 확정 안내]

안녕하세요, ${firstName}님
오브유케이크 입니다.

아래와 같이 케이크가 예약 되었습니다.

✔️ 케이크 디자인: ${order.design}
✔️ 사이즈: ${order.size}
✔️ 맛: ${order.flavor}
✔️ 픽업시간: ${pickupDateTime}
✔️ 요청사항: ${requestsText}

변경 및 취소는 픽업 4일 전까지만 가능합니다.
문의나 요청이 있으시면 언제든지 편하게 말씀해주세요.
당신의 하루가 더욱 특별해질 수 있도록, 오브유가 정성껏 준비해드릴게요.

감사합니다. `;
    }

    if (type === 'pickup') {
      return `[OF YOU 케이크 픽업 안내]

안녕하세요, ${firstName}님  
오브유케이크 입니다.

내일은 케이크 픽업날입니다.

✔️ 픽업시간: ${pickupDateTime}
✔️ 픽업주소: 서울시 강서구 마곡동 771-4 이너매스마곡1 501호 (5층 가장 오른쪽에 위치해있습니다)
 
오브유케이크는 예약 일정에 맞춰 매장 운영시간이 유동적으로 운영됩니다.
변경사항 있으시면 꼭 연락주세요:) 
내일 뵙겠습니다! `;
    }

    if (type === 'unmanned') {
      return `[오브유 케이크 무인픽업 안내]

안녕하세요, 오브유케이크입니다.
주문해주신 케이크는 내일 무인 픽업으로 준비되어 있습니다.

아래 링크를 통해 매장 출입이 가능하시며, 
매장 내 냉장고에서 수령 부탁드립니다.

🔓 출입 링크: 
📍 매장 주소: 서울시 강서구 마곡동 771-4 이너매스마곡1 501호 
⏰ 픽업 가능 시간: ${pickupRange} (해당 시간에만 문이 열립니다)

✔️ 케이크 픽업 후 꼭 문이 닫혔는지 확인 부탁드려요. (살짝 앞으로 당겨주셔야 잠깁니다.)
✔️ 제품 특성상 수령 후 빠른 시간 내 냉장 보관을 권장드립니다.
✔️ 주차는 30분 무료 회차입니다. 
✔️ 무더운 날씨로 인해 30분 이상 이동 시에는 보냉백 지참을 권장드립니다. 보냉백 구매를 원하실 경우, 미리 말씀해주시면 함께 준비해드릴게요 😊

문의 사항이 있으실 경우, 언제든지 편하게 연락 주세요.
감사합니다.`;
    }

    return '';
  };

  // 클립보드 복사
  const handleCopy = async (type, order) => {
    const text = generateMessage(type, order);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // fallback for http / older browsers
        const el = document.createElement('textarea');
        el.value = text;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.focus();
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 1500);
    } catch (err) {
      alert('복사에 실패했습니다. 직접 선택하여 복사해주세요.');
    }
  };

  // Normalized compare helper
  const isDateInRange = (dateStr, start, end) => {
    if (!dateStr || !start || !end) return false;
    const normalizedDate = normalizeDateKey(dateStr);
    const normalizedStart = normalizeDateKey(start);
    const normalizedEnd = normalizeDateKey(end);
    return normalizedDate >= normalizedStart && normalizedDate <= normalizedEnd;
  };

  const handleDashboardDateSelect = (dateStr) => {
    const normalizedDate = normalizeDateKey(dateStr);

    if (activeTab === 'day') {
      if (compareDateKeys(normalizedDate, selectedDate) === 0) return;
      const [rangeStart, rangeEnd] = [selectedDate, normalizedDate].sort(compareDateKeys);
      setStartDate(rangeStart);
      setEndDate(rangeEnd);
      setActiveTab('period');
      return;
    }

    setSelectedDate(normalizedDate);
    setStartDate(null);
    setEndDate(null);
    setActiveTab('day');
  };

  const handleStatsDateSelect = (dateStr) => {
    const normalizedDate = normalizeDateKey(dateStr);

    if (!statsStartDate || statsEndDate) {
      setStatsStartDate(normalizedDate);
      setStatsEndDate(null);
      return;
    }

    const [rangeStart, rangeEnd] = [statsStartDate, normalizedDate].sort(compareDateKeys);
    setStatsStartDate(rangeStart);
    setStatsEndDate(rangeEnd);
    setTimeout(() => setShowStatsDatePicker(false), 300);
  };

  const filterOptions = useMemo(() => {
    const opts = { design: new Set(), sheet: new Set(), cream: new Set(), flavor: new Set(), size: new Set() };
    orders.forEach(o => {
      if (o.design && o.design !== '-') opts.design.add(o.design);
      if (o.sheet && o.sheet !== '-') opts.sheet.add(o.sheet);
      if (o.cream && o.cream !== '-') opts.cream.add(o.cream);
      if (o.flavor && o.flavor !== '-') opts.flavor.add(o.flavor);
      if (o.size && o.size !== '-') opts.size.add(o.size);
    });
    return { 
      design: [...opts.design].sort(), 
      sheet: [...opts.sheet].sort(), 
      cream: [...opts.cream].sort(), 
      flavor: [...opts.flavor].sort(), 
      size: [...opts.size].sort() 
    };
  }, [orders]);

  const toggleFilter = (type, value) => {
    setFilters(prev => {
      const arr = prev[type] || [];
      if (arr.includes(value)) return { ...prev, [type]: arr.filter(v => v !== value) };
      return { ...prev, [type]: [...arr, value] };
    });
  };

  const resetFilters = () => {
    setFilters({ design: [], sheet: [], cream: [], flavor: [], size: [] });
  };

  const toggleAccordion = (type) => {
    setExpandedFilters(prev => ({ ...prev, [type]: !prev[type] }));
  };

  const applyFilters = (list) => {
    return list.filter(o => {
      if (filters.design?.length > 0 && !filters.design.includes(o.design)) return false;
      if (filters.sheet?.length > 0 && !filters.sheet.includes(o.sheet)) return false;
      if (filters.cream?.length > 0 && !filters.cream.includes(o.cream)) return false;
      if (filters.flavor?.length > 0 && !filters.flavor.includes(o.flavor)) return false;
      if (filters.size?.length > 0 && !filters.size.includes(o.size)) return false;
      return true;
    });
  };

  const activeFiltersCount = useMemo(() => {
    return Object.values(filters).reduce((sum, arr) => sum + (arr?.length || 0), 0);
  }, [filters]);

  const dashboardOrders = useMemo(() => {
    const normalizedSelected = normalizeDateKey(selectedDate);
    const base = activeTab === 'day'
      ? orders.filter(o => o.dateOnly === normalizedSelected)
      : (!startDate || !endDate ? [] : orders.filter(o => isDateInRange(o.dateOnly, startDate, endDate)));
    return applyFilters(base);
  }, [orders, activeTab, selectedDate, startDate, endDate, filters]);

  const statsOrders = useMemo(() => {
    if (!statsStartDate || !statsEndDate) return [];
    const base = orders.filter(o => isDateInRange(o.dateOnly, statsStartDate, statsEndDate));
    return applyFilters(base);
  }, [orders, statsStartDate, statsEndDate, filters]);

   const statsData = useMemo(() => {
    const totalRevenue = statsOrders.reduce((sum, o) => sum + o.price, 0);
    const designCount = {};
    const flavorCount = {};
    const sheetCount = {};
    statsOrders.forEach(o => {
      if (o.design) designCount[o.design] = (designCount[o.design] || 0) + 1;
      if (o.flavor) flavorCount[o.flavor] = (flavorCount[o.flavor] || 0) + 1;
      if (o.sheet) sheetCount[o.sheet] = (sheetCount[o.sheet] || 0) + 1;
    });
    return { totalRevenue, totalCount: statsOrders.length, designCount, flavorCount, sheetCount };
  }, [statsOrders]);

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= lastDate; i++) days.push(new Date(year, month, i));
    return days;
  };

  const formatDate = (date) => {
    if (!date) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}.${m}.${d}`;
  };

  const renderFilterPopup = () => {
    const filterLabels = { design: '디자인', sheet: '시트', cream: '크림', flavor: '맛선택', size: '사이즈' };
    
    return (
      <div ref={filterRef} className="filter-popup" style={{ position: 'absolute', top: 'calc(100% + 12px)', right: 0, width: '320px', maxWidth: 'calc(100vw - 32px)', backgroundColor: 'white', borderRadius: '24px', boxShadow: '0 25px 60px rgba(0,0,0,0.18)', border: '1px solid var(--line)', padding: '24px', zIndex: 2000, maxHeight: '400px', overflowY: 'auto' }}>
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', position: 'sticky', top: '-24px', backgroundColor: 'white', padding: '24px 0 16px 0', marginTop: '-24px', borderBottom: '1px solid var(--line)', zIndex: 10 }}>
           <h4 style={{ fontWeight: '800', margin: 0 }}>상세 필터</h4>
           {activeFiltersCount > 0 && (
             <div onClick={resetFilters} style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', backgroundColor: 'var(--surface-soft)' }}>
               초기화 ↺
             </div>
           )}
         </div>
         {['design', 'sheet', 'cream', 'flavor', 'size'].map(type => (
           <div key={type} style={{ marginBottom: '12px', borderBottom: '1px solid var(--line-soft)', paddingBottom: '12px' }}>
             <div onClick={() => toggleAccordion(type)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '4px 0' }}>
               <div style={{ fontSize: '14px', fontWeight: '800', color: filters[type]?.length > 0 ? 'var(--point)' : 'var(--text-main)' }}>
                 {filterLabels[type]} {filters[type]?.length > 0 && `(${filters[type].length})`}
               </div>
               <div style={{ fontSize: '10px', color: 'var(--text-sub)' }}>
                 {expandedFilters[type] ? '▲' : '▼'}
               </div>
             </div>
             {expandedFilters[type] && (
               <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                 {filterOptions[type]?.length > 0 ? filterOptions[type].map(val => (
                   <div key={val} onClick={() => toggleFilter(type, val)} style={{ padding: '6px 12px', borderRadius: 'var(--radius-full)', fontSize: '12px', fontWeight: '600', cursor: 'pointer', backgroundColor: filters[type]?.includes(val) ? 'var(--point)' : 'var(--surface-soft)', color: filters[type]?.includes(val) ? 'white' : 'var(--text-sub)' }}>
                     {val}
                   </div>
                 )) : <div style={{ fontSize: '12px', color: 'var(--text-sub)' }}>옵션 없음</div>}
               </div>
             )}
           </div>
         ))}
      </div>
    );
  };

  const renderCalendar = (type, currentStart, currentEnd, onSelect, inline = false) => {
    const days = getDaysInMonth(viewDate);
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth() + 1;
    const todayKey = getKSTDateKey();

    const wrapperStyle = inline 
      ? { width: '320px', backgroundColor: 'white', borderRadius: '24px', padding: '24px', border: '1px solid var(--line)', boxShadow: 'var(--shadow-elevation)' }
      : { position: 'absolute', top: 'calc(100% + 12px)', right: 0, width: '320px', backgroundColor: 'white', borderRadius: '24px', boxShadow: '0 25px 60px rgba(0,0,0,0.18)', border: '1px solid var(--line)', padding: '24px', zIndex: 2000 };

    return (
      <div className={inline ? "calendar-inline" : "calendar-popup"} style={wrapperStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <button onClick={() => setViewDate(new Date(year, month - 2, 1))} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px', fontWeight: 'bold' }}>&lt;</button>
          <div style={{ fontWeight: '900', fontSize: '16px', whiteSpace: 'nowrap' }}>{year}년 {month}월</div>
          <button onClick={() => setViewDate(new Date(year, month, 1))} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px', fontWeight: 'bold' }}>&gt;</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', marginBottom: '8px' }}>
          {['일','월','화','수','목','금','토'].map((d, i) => <div key={d} style={{ fontSize: '12px', fontWeight: '700', color: i === 0 ? 'var(--error)' : 'var(--text-sub)', opacity: 0.5 }}>{d}</div>)}
          {days.map((date, i) => {
            if (!date) return <div key={`empty-${i}`} />;
            const dateStr = formatDate(date);
            const isSelected = type === 'day' ? selectedDate === dateStr : (dateStr === currentStart || dateStr === currentEnd);
            const isInRange = type !== 'day' && currentStart && currentEnd && compareDateKeys(dateStr, currentStart) > 0 && compareDateKeys(dateStr, currentEnd) < 0;
            const isToday = dateStr === todayKey;
            
            return (
              <div key={dateStr} onClick={() => onSelect(dateStr)}
              style={{ padding: '10px 0', borderRadius: isToday && !isSelected && !isInRange ? '50%' : '12px', cursor: 'pointer', fontSize: '13px', fontWeight: '700', backgroundColor: isSelected ? 'var(--point)' : (isInRange ? 'var(--point-light)' : (isToday ? '#f1f5f9' : 'transparent')), color: isSelected ? 'white' : (isInRange ? 'var(--point)' : 'var(--text-main)') }}>
                {date.getDate()}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderDashboard = () => (
    <div className="flex flex-col gap-md" style={{ position: 'relative' }}>
      <div className="card" style={{ padding: '0', overflow: 'visible', zIndex: 100 }}>
        <div className="dash-header-bar" style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', backgroundColor: 'var(--surface-soft)', borderRadius: 'var(--radius-full)', fontSize: '14px', fontWeight: '700' }}>
              <span style={{ color: 'var(--point)' }}>{activeTab === 'day' ? '하루 선택' : '기간 선택'}</span>
              <span style={{ color: 'var(--text-sub)' }}>
                {activeTab === 'day' ? selectedDate : `${startDate} - ${endDate}`}
              </span>
            </div>
            <div className="dash-order-badge" style={{ fontSize: '14px', fontWeight: '800', color: 'var(--point)', backgroundColor: 'var(--point-light)', padding: '6px 12px', borderRadius: 'var(--radius-full)' }}>
              {dashboardOrders.length} 주문
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {/* 모바일: 날짜 팝업 버튼 제거 — 달력은 카드 하단에 항상 표시 */}
            <div style={{ position: 'relative' }}>
              <div className="filter-toggle-btn" onClick={() => setShowFilterPicker(!showFilterPicker)} style={{ padding: '12px 24px', backgroundColor: 'white', border: '1px solid var(--line)', borderRadius: 'var(--radius-full)', cursor: 'pointer', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: 'var(--shadow-elevation)', color: activeFiltersCount > 0 ? 'var(--point)' : 'inherit' }}>
                🎛️ <span className="desktop-only" style={{ marginLeft: '4px' }}>필터</span>{activeFiltersCount > 0 && <span style={{ fontSize: '11px', fontWeight: '800', color: 'var(--point)', marginLeft: '2px' }}>({activeFiltersCount})</span>}
              </div>
              {showFilterPicker && renderFilterPopup()}
            </div>
          </div>
        </div>

        {/* 모바일 전용 인라인 달력 — 항상 표시 */}
        <div className="mobile-only" style={{ borderTop: '1px solid var(--line)' }}>
          {renderCalendar(activeTab, startDate, endDate, handleDashboardDateSelect, true)}
        </div>
        
        <div style={{ padding: '24px', minHeight: '400px' }}>
          {activeTab === 'day' ? (
           (() => {
             const orderHours = dashboardOrders.map(o => {
               const [h] = o.time.split(':').map(Number);
               return h;
             });
             const startHour = orderHours.length > 0 ? Math.min(9, ...orderHours) : 9;
             const endHour = orderHours.length > 0 ? Math.max(20, ...orderHours) : 20;
             const dynamicHours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);

             return (
               <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                 {dynamicHours.map(hourNum => {
                   const hourStr = `${hourNum}:00`;
                   const ordersInHour = dashboardOrders.filter(o => {
                     const [h] = o.time.split(':').map(Number);
                     return h === hourNum;
                   });
                   const hasOrders = ordersInHour.length > 0;
                   
                   return (
                     <div key={hourStr} style={{ display: 'flex', minHeight: hasOrders ? 'auto' : '48px', borderBottom: '1px solid var(--line-soft)', transition: 'all 0.3s ease' }}>
                       <div style={{ width: '60px', padding: '16px 12px 16px 0', borderRight: '2px solid var(--line)', textAlign: 'right', fontSize: '13px', fontWeight: '700', color: hasOrders ? 'var(--text-main)' : 'var(--text-sub)', opacity: hasOrders ? 1 : 0.4 }}>
                         {hourStr}
                       </div>
                       <div style={{ flex: 1, padding: '8px 12px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'flex-start' }}>
                         {ordersInHour.sort((a,b) => a.time.localeCompare(b.time)).map(order => {
                           const isHalfHour = order.time.includes(':30');
                           const hasOnTheHour = ordersInHour.some(o => !o.time.includes(':30'));
                           const hasHalfHour = ordersInHour.some(o => o.time.includes(':30'));
                           const hasBoth = hasOnTheHour && hasHalfHour;
                           
                           const sameTimeOrders = ordersInHour.filter(o => o.time === order.time);
                           const n = sameTimeOrders.length;
                           return (
                             <div key={order.id} className={`order-card-wrapper ${isHalfHour ? 'half-hour-card' : ''}`} style={{ 
                               flexBasis: n > 1 ? `calc(${100 / n}% - 8px)` : '100%', 
                               flexGrow: 1,
                               paddingLeft: isHalfHour ? '32px' : '0',
                               marginTop: isHalfHour ? (hasBoth ? '4px' : '32px') : '4px',
                               marginBottom: isHalfHour ? '4px' : (hasBoth ? '4px' : '32px'),
                               transition: 'all 0.3s ease'
                             }}>
                               <OrderCard 
                                 time={order.time} 
                                 customer={order.customer} 
                                 items={[`${order.design} (${order.sheet})`]} 
                                 color={isHalfHour ? '#3B82F6' : 'var(--point)'}
                                 onClick={() => handleOrderClick(order)} 
                               />
                             </div>
                           );
                         })}
                       </div>
                     </div>
                   );
                 })}
                 {dashboardOrders.length === 0 && <div style={{ textAlign: 'center', padding: '100px', color: 'var(--text-sub)' }}>선택한 날짜에 주문이 없습니다.</div>}
               </div>
             );
           })()
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
              {Array.from(new Set(dashboardOrders.map(o => o.dateOnly))).sort().map(date => {
                const dailyCount = dashboardOrders.filter(o => o.dateOnly === date).length;
                return (
                  <div key={date} className="flex flex-col gap-md">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <h3 style={{ fontSize: '16px', fontWeight: '800' }}>{date}</h3>
                      <span style={{ fontSize: '12px', fontWeight: '800', color: 'var(--point)', backgroundColor: 'var(--point-light)', padding: '2px 8px', borderRadius: 'var(--radius-full)' }}>
                        {dailyCount} 주문
                      </span>
                    </div>
                    <div className="period-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
                      {dashboardOrders.filter(o => o.dateOnly === date).sort((a, b) => a.time.localeCompare(b.time)).map(o => <OrderCard key={o.id} time={o.time} customer={o.customer} items={[`${o.design} (${o.sheet})`]} color={o.time.includes(':30') ? '#3B82F6' : 'var(--point)'} onClick={() => handleOrderClick(o)} />)}
                    </div>
                  </div>
                );
              })}
              {dashboardOrders.length === 0 && <div style={{ textAlign: 'center', padding: '100px', color: 'var(--text-sub)' }}>선택한 기간에 주문이 없습니다.</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderStatistics = () => {
    const renderRankCard = (title, countMap, color, icon) => {
      const sortedItems = Object.entries(countMap || {})
        .filter(([name]) => name && name !== '-')
        .sort((a, b) => b[1] - a[1]);

      return (
        <div className="card" style={{ padding: '32px', borderTop: `4px solid ${color}`, borderRadius: '24px', backgroundColor: 'white', display: 'flex', flexDirection: 'column', transition: 'all 0.3s ease' }}>
          <h3 style={{ marginBottom: '24px', fontSize: '18px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{icon}</span> {title}
          </h3>
          <div className="flex flex-col gap-sm" style={{ flex: 1 }}>
            {sortedItems.map(([name, count], index) => {
              const isTop3 = index < 3;
              const rankColors = ['#F59E0B', '#9CA3AF', '#B45309']; // Gold, Silver, Bronze
              return (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line-soft)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ 
                      fontSize: '12px', 
                      fontWeight: '800', 
                      width: '24px', 
                      height: '24px', 
                      borderRadius: '50%', 
                      backgroundColor: isTop3 ? `${rankColors[index]}15` : 'var(--surface-soft)', 
                      color: isTop3 ? rankColors[index] : 'var(--text-sub)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center' 
                    }}>
                      {index + 1}
                    </span>
                    <span style={{ fontWeight: '700', color: 'var(--text-main)', fontSize: '14px' }}>{name}</span>
                  </div>
                  <span style={{ fontWeight: '800', color: color, fontSize: '14px' }}>{count}건</span>
                </div>
              );
            })}
            {sortedItems.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-sub)' }}>조회된 데이터가 없습니다.</div>}
          </div>
        </div>
      );
    };

    return (
      <div className="flex flex-col gap-md">
        <div className="card" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', overflow: 'visible' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '800' }}>기간별 통계 조회</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div className="mobile-only" style={{ position: 'relative' }}>
              <div onClick={() => setShowStatsDatePicker(!showStatsDatePicker)} style={{ padding: '12px 24px', backgroundColor: 'white', border: '1px solid var(--line)', borderRadius: 'var(--radius-full)', cursor: 'pointer', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: 'var(--shadow-elevation)' }}>
                📅 {statsStartDate && statsEndDate ? `${statsStartDate} - ${statsEndDate}` : '통계 기간 선택'}
              </div>
              {showStatsDatePicker && (
                <>
                  <div 
                    onClick={() => setShowStatsDatePicker(false)} 
                    style={{
                      position: 'fixed',
                      top: 0,
                      left: 0,
                      width: '100vw',
                      height: '100vh',
                      backgroundColor: 'rgba(0, 0, 0, 0.4)',
                      zIndex: 1999,
                      backdropFilter: 'blur(4px)'
                    }} 
                  />
                  {renderCalendar('period', statsStartDate, statsEndDate, handleStatsDateSelect)}
                </>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <div className="filter-toggle-btn" onClick={() => setShowFilterPicker(!showFilterPicker)} style={{ padding: '12px 24px', backgroundColor: 'white', border: '1px solid var(--line)', borderRadius: 'var(--radius-full)', cursor: 'pointer', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: 'var(--shadow-elevation)', color: activeFiltersCount > 0 ? 'var(--point)' : 'inherit' }}>
                🎛️ <span className="desktop-only" style={{ marginLeft: '4px' }}>필터</span>{activeFiltersCount > 0 && <span style={{ fontSize: '11px', fontWeight: '800', color: 'var(--point)', marginLeft: '2px' }}>({activeFiltersCount})</span>}
              </div>
              {showFilterPicker && renderFilterPopup()}
            </div>
          </div>
        </div>

        <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          <div className="card" style={{ padding: '32px' }}>
            <div style={{ color: 'var(--text-sub)', fontSize: '14px', fontWeight: '600' }}>총 매출</div>
            <div style={{ fontSize: '28px', fontWeight: '800', marginTop: '8px' }}>{statsData.totalRevenue.toLocaleString()}원</div>
          </div>
          <div className="card" style={{ padding: '32px' }}>
            <div style={{ color: 'var(--text-sub)', fontSize: '14px', fontWeight: '600' }}>총 주문수</div>
            <div style={{ fontSize: '28px', fontWeight: '800', marginTop: '8px' }}>{statsData.totalCount}건</div>
          </div>
        </div>

        <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          {renderRankCard('인기 디자인 순위', statsData.designCount, '#F43F5E', '🎨')}
          {renderRankCard('인기 맛 순위', statsData.flavorCount, '#3B82F6', '🍰')}
          {renderRankCard('인기 시트 순위', statsData.sheetCount, '#10B981', '🍞')}
        </div>
      </div>
    );
  };

  const renderMyPage = () => (
    <div className="card" style={{ padding: '48px', maxWidth: '800px' }}>
      <h3 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '24px' }}>구글 스프레드시트 연동 설정</h3>
      <p style={{ color: 'var(--text-sub)', fontSize: '14px', marginBottom: '32px' }}>연동할 구글 시트의 주소를 입력해주세요. 정보는 수파베이스 DB에 안전하게 보관됩니다.</p>
      <div className="flex flex-col gap-md">
        <Input label="구글 시트 주소" value={sheetInfo} onChange={(e) => setSheetInfo(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
        <Button onClick={() => handleSaveSheetInfo(sheetInfo)} size="large" disabled={loading}>{loading ? '저장 중...' : '설정 저장하기'}</Button>
        {sheetInfo && (
          <Button variant="secondary" onClick={() => window.open(sheetInfo, '_blank')} style={{ marginTop: '16px' }}>
            내 구글 시트 바로가기 ↗
          </Button>
        )}
      </div>
      <div className="mobile-logout" style={{ display: 'none', marginTop: '48px' }}>
        <Button variant="secondary" onClick={onLogout} style={{ width: '100%', color: 'var(--error)' }}>로그아웃</Button>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-main)' }}>
      <div className="sidebar">
        <div style={{ padding: '0 24px', marginBottom: '32px' }}><h2 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--point)' }}>MyOrder</h2></div>
        <nav className="flex flex-col" style={{ padding: '0 16px' }}>
          {menuItems.map(item => (
            <div key={item.id} onClick={() => setActiveMenu(item.id)} className={`nav-item ${activeMenu === item.id ? 'active' : ''}`} style={{ padding: '14px 20px', borderRadius: '12px', cursor: 'pointer', marginBottom: '4px', fontWeight: '700' }}>{item.label}</div>
          ))}
        </nav>
        <div className="sidebar-logout" style={{ position: 'absolute', bottom: '32px', width: '100%', padding: '0 24px' }}><Button variant="secondary" onClick={onLogout} style={{ width: '100%', color: 'var(--error)' }}>로그아웃</Button></div>
      </div>

      <div className="main-content" style={{ flex: 1, maxWidth: '1200px', paddingBottom: '100px' }}>
        <header className="header-actions" style={{ marginBottom: '48px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1 className="h1" style={{ fontSize: '32px' }}>{menuItems.find(i => i.id === activeMenu)?.label}</h1>
                <p className="text-sub" style={{ marginTop: '8px' }}>{session.user.email}님, 환영합니다!</p>
              </div>

              <div className="desktop-only" style={{ flex: 1, display: 'flex', justifyContent: 'center', margin: '0 24px' }}>
                {activeMenu === 'dashboard' && renderCalendar(
                  activeTab, startDate, endDate, handleDashboardDateSelect, true
                )}
                {activeMenu === 'statistics' && renderCalendar(
                  'period', statsStartDate, statsEndDate, handleStatsDateSelect, true
                )}
              </div>

              <div 
                onClick={() => loadSheetData(sheetInfo)} 
                style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-sub)', cursor: 'pointer', backgroundColor: 'var(--surface-soft)', padding: '8px 16px', borderRadius: 'var(--radius-full)', transition: 'all 0.2s', marginTop: '4px' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--point-light)'; e.currentTarget.style.color = 'var(--point)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-soft)'; e.currentTarget.style.color = 'var(--text-sub)'; }}
              >
                새로고침
              </div>
            </div>
          </div>
        </header>

        {activeMenu === 'dashboard' ? renderDashboard() : activeMenu === 'statistics' ? renderStatistics() : renderMyPage()}

        {showDetailModal && selectedOrder && (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, backdropFilter: 'blur(10px)', padding: '0 0 80px 0' }}>
            <div className="card modal-content" style={{ width: '90%', maxWidth: '700px', padding: '0', borderRadius: '32px', position: 'relative', border: 'none', animation: 'slideUp 0.3s ease-out', overflow: 'hidden', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ padding: '32px', backgroundColor: 'white' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                  <h2 style={{ fontSize: '22px', fontWeight: '800' }}>주문 상세 내역</h2>
                  <button onClick={() => setShowDetailModal(false)} style={{ border: 'none', background: 'none', fontSize: '28px', cursor: 'pointer', opacity: 0.3 }}>×</button>
                </div>

                <div className="modal-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  {/* Basic Info Card */}
                  <div style={{ padding: '24px', borderRadius: '20px', border: '1px solid var(--line)', backgroundColor: '#F8FAFC' }}>
                    <h4 style={{ fontSize: '14px', fontWeight: '800', color: 'var(--point)', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>📅 기본 정보</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                      <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>고객명</label><div style={{ fontSize: '15px', fontWeight: '700', marginTop: '4px' }}>{selectedOrder.customer}</div></div>
                      <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>연락처</label><div style={{ fontSize: '15px', fontWeight: '700', marginTop: '4px' }}>{selectedOrder.contact}</div></div>
                      <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>주문일자</label><div style={{ fontSize: '15px', fontWeight: '700', marginTop: '4px' }}>{selectedOrder.orderDate}</div></div>
                      <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>픽업일시</label><div style={{ fontSize: '15px', fontWeight: '700', marginTop: '4px' }}>{selectedOrder.pickupDate}</div></div>
                      <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>주문경로</label><div style={{ fontSize: '13px', fontWeight: '700', marginTop: '4px', display: 'inline-block', padding: '4px 12px', backgroundColor: 'white', borderRadius: '12px', border: '1px solid var(--line)' }}>{selectedOrder.orderPath}</div></div>
                    </div>
                  </div>

                  {/* Cake Info Card */}
                  <div style={{ padding: '24px', borderRadius: '20px', border: '1px solid #FFE4E6', backgroundColor: '#FFF9F9' }}>
                    <h4 style={{ fontSize: '14px', fontWeight: '800', color: '#E11D48', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>🎂 케이크 정보</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                      <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>디자인</label><div style={{ fontSize: '15px', fontWeight: '700', marginTop: '4px' }}>{selectedOrder.design}</div></div>
                      <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>맛 선택</label><div style={{ fontSize: '15px', fontWeight: '700', marginTop: '4px' }}>{selectedOrder.flavor}</div></div>
                      <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>시트</label><div style={{ fontSize: '15px', fontWeight: '700', marginTop: '4px' }}>{selectedOrder.sheet}</div></div>
                      <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>사이즈</label><div style={{ fontSize: '15px', fontWeight: '700', marginTop: '4px' }}>{selectedOrder.size}</div></div>
                      <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>크림</label><div style={{ fontSize: '15px', fontWeight: '700', marginTop: '4px' }}>{selectedOrder.cream}</div></div>
                      <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>가격</label><div style={{ fontSize: '15px', fontWeight: '800', color: 'var(--point)', marginTop: '4px' }}>{selectedOrder.price.toLocaleString()}원</div></div>
                    </div>
                    <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px dashed #FDA4AF' }}>
                      <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>요청/특이사항</label>
                      <div style={{ fontSize: '14px', fontWeight: '500', marginTop: '8px', lineHeight: '1.6' }}>
                        {selectedOrder.requests} / {selectedOrder.specialNotes}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 메시지 복사 버튼 섹션 */}
                <div style={{ marginTop: '28px', paddingTop: '24px', borderTop: '1px solid var(--line)' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-sub)', marginBottom: '12px' }}>📋 메시지 복사</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                    {[
                      { type: 'order',       label: '📄 주문서' },
                      { type: 'reservation', label: '✅ 예약확정' },
                      { type: 'pickup',      label: '🚗 픽업안내' },
                      { type: 'unmanned',    label: '🔓 무인픽업안내' },
                    ].map(({ type, label }) => (
                      <button
                        key={type}
                        onClick={() => handleCopy(type, selectedOrder)}
                        style={{
                          padding: '12px 8px',
                          borderRadius: '12px',
                          border: `1px solid ${copiedType === type ? '#10B981' : 'var(--line)'}`,
                          background: copiedType === type ? '#ECFDF5' : 'white',
                          color: copiedType === type ? '#10B981' : 'var(--text-main)',
                          fontWeight: '700',
                          fontSize: '13px',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                        }}
                      >
                        {copiedType === type ? '✓ 복사됨!' : label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <Button onClick={() => setShowDetailModal(false)} size="large" style={{ width: '100%' }}>닫기</Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {loading && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(255, 255, 255, 0.8)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(8px)' }}>
          <div style={{ width: '48px', height: '48px', border: '4px solid var(--point-light)', borderTop: '4px solid var(--point)', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '16px' }} />
          <div style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>구글 시트에서 주문 데이터 동기화 중...</div>
        </div>
      )}
      <style>{`
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>
    </div>
  );
};

export default DashboardPage;
