import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { OrderCard } from '../components/OrderCard';
import OrderFormModal from '../components/OrderFormModal';
import OrderDetailModal, { OrderDeleteModal } from '../components/OrderDetailModal';
import { canManageOrder, createOrdersClient, isUnknownWriteError } from '../api/orders';
import { supabase } from '../supabaseClient';
import Papa from 'papaparse';
import { ORDER_TEXT_FIELDS, preserveOrderText, groupOrderText, matchesOrderFilters } from '../orderText';

const KST_TIME_ZONE = 'Asia/Seoul';
const isTestPage = typeof window !== 'undefined' && window.location.pathname === '/order-test';
const ORDER_API_ENABLED = isTestPage || import.meta.env.VITE_ORDER_API_ENABLED === 'true';
const ORDER_API_BASE_PATH = isTestPage ? '/api/order-tests' : '/api/orders';
const DEFINITIVE_NON_WRITE_CODES = new Set([
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'CONFLICT',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'ORDER_NOT_READY',
  'RATE_LIMITED',
]);
const UNKNOWN_WRITE_MESSAGE = '처리 결과를 확인하지 못했습니다. 입력 내용은 잠겨 있습니다. 같은 요청으로 다시 확인하거나 서버 상태를 확인하기 전에는 새 작업을 시작하지 마세요.';
const ordersClient = createOrdersClient({
  basePath: ORDER_API_BASE_PATH,
  getAccessToken: async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session?.access_token;
  },
});

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
  const normalized = normalizeDateKey(dateKey);
  const parts = normalized.split('.').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return null;

  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
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
  const [orderEditor, setOrderEditor] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [pendingMutation, setPendingMutation] = useState(null);
  const [orderFeedback, setOrderFeedback] = useState('');
  const [loadError, setLoadError] = useState('');
  const mutationLock = useRef(false);
  const loadSequence = useRef(0);

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
    if (!ORDER_API_ENABLED && !info) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError('');
    try {
      if (ORDER_API_ENABLED) {
        const latestOrders = await ordersClient.list();
        if (sequence === loadSequence.current) {
          setOrders(latestOrders.map(order => ({ ...order, time: order.pickupDate.split(' ')[1] || '00:00', dateOnly: normalizeDateKey(order.pickupDate.split(' ')[0]) })));
        }
        return;
      }
      let sheetId = info;
      if (info.includes('/d/')) sheetId = info.split('/d/')[1].split('/')[0];
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
      const response = await fetch(csvUrl);
      if (!response.ok) throw new Error('시트를 불러오지 못했습니다.');
      const csvText = await response.text();
      
      // Use header: false to handle the empty column M header issue
      Papa.parse(csvText, {
        header: false,
        skipEmptyLines: true,
        complete: (results) => {
          // Skip the first header row
          const dataRows = results.data.slice(1).filter(row => row.slice(0, 11).some(value => String(value || '').trim()));
          const mapped = dataRows.map((row, index) => {
            const pickupDateRaw = row[3] || ''; // Column D
            const [dPart, tPart] = pickupDateRaw.includes(' ') ? pickupDateRaw.split(' ') : [pickupDateRaw, '00:00'];
            
            // Normalize date string to yyyy.mm.dd (handle 2026.5.8 -> 2026.05.08)
            const normalizedDate = normalizeDateKey(dPart);

            return {
              id: `sheet-${index}`,
              customer: row[0] || '미지명', // A
              design: preserveOrderText(row[1]), // B
              orderDate: row[2] || '-', // C
              pickupDate: pickupDateRaw, // D
              time: tPart || '00:00',
              dateOnly: normalizedDate,
              flavor: preserveOrderText(row[4]), // E
              sheet: preserveOrderText(row[5]), // F
              size: preserveOrderText(row[6]), // G
              cream: preserveOrderText(row[7]), // H
              requests: row[8] || '-', // I
              specialNotes: row[9] || '-', // J
              orderPath: row[10] || '-', // K
              price: parseInt((row[12] || '0').replace(/[^0-9]/g, '')) || 0, // M
            };
          });
          if (sequence === loadSequence.current) setOrders(mapped);
        }
      });
    } catch (error) {
      if (sequence === loadSequence.current) {
        setLoadError(ORDER_API_ENABLED ? error.message : '시트를 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요.');
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => { loadSheetData(sheetInfo); }, [sheetInfo, loadSheetData]);

  const handleOrderClick = (order) => { 
    setSelectedOrder(order); 
    setShowDetailModal(true);
    setCopiedType(null);
  };

  const openOrderEditor = (order = null) => {
    if (mutationLock.current || pendingMutation) return;
    setMutationError('');
    setOrderFeedback('');
    setShowDetailModal(false);
    setOrderEditor({ order, requestId: crypto.randomUUID(), editorKey: crypto.randomUUID() });
  };

  const closeOrderEditor = () => {
    if (mutationLock.current || pendingMutation) return;
    const editing = orderEditor?.order;
    setOrderEditor(null);
    setMutationError('');
    if (editing) setShowDetailModal(true);
  };

  const saveOrder = async (input, retryRequestId = null) => {
    const pendingSave = pendingMutation?.kind === 'save' ? pendingMutation : null;
    const requestId = retryRequestId || orderEditor?.requestId;
    if (
      mutationLock.current
      || !orderEditor
      || !ORDER_API_ENABLED
      || (pendingMutation && (!pendingSave || pendingSave.requestId !== requestId))
    ) return;

    const editor = orderEditor;
    const submittedInput = pendingSave ? pendingSave.input : Object.freeze({ ...input });
    mutationLock.current = true;
    setMutationBusy(true);
    setMutationError('');
    try {
      const saved = editor.order
        ? await ordersClient.update(editor.order, submittedInput, requestId)
        : await ordersClient.create(submittedInput, requestId);
      const pickupParts = saved.pickupDate.split(' ');
      const updated = { ...saved, time: pickupParts[1] || '00:00', dateOnly: normalizeDateKey(pickupParts[0]) };
      ++loadSequence.current;
      setLoading(false);
      setLoadError('');
      setOrders(previous => [...previous.filter(order => order.id !== updated.id), updated]);
      setSelectedOrder(updated);
      setCopiedType(null);
      setPendingMutation(null);
      if (updated.dateOnly) {
        setSelectedDate(updated.dateOnly);
        const calendarDate = getCalendarDateFromKey(updated.dateOnly);
        if (calendarDate) setViewDate(calendarDate);
      }
      setStartDate(null);
      setEndDate(null);
      setActiveTab('day');
      setOrderFeedback(editor.order ? '주문을 수정했습니다.' : '주문을 등록했습니다.');
      setOrderEditor(null);
      setShowDetailModal(true);
    } catch (error) {
      if (isUnknownWriteError(error)) {
        setPendingMutation({ kind: 'save', order: editor.order, requestId, input: submittedInput });
        setMutationError(UNKNOWN_WRITE_MESSAGE);
      } else {
        setPendingMutation(null);
        setMutationError(error.message);
        if (DEFINITIVE_NON_WRITE_CODES.has(error.code)) {
          setOrderEditor(current => current ? { ...current, requestId: crypto.randomUUID() } : current);
        }
      }
    } finally {
      mutationLock.current = false;
      setMutationBusy(false);
    }
  };

  const confirmDelete = async (retryRequestId = null) => {
    const pendingDelete = pendingMutation?.kind === 'delete' ? pendingMutation : null;
    const requestId = retryRequestId || deleteTarget?.requestId;
    if (
      mutationLock.current
      || !deleteTarget
      || !ORDER_API_ENABLED
      || (pendingMutation && (!pendingDelete || pendingDelete.requestId !== requestId))
    ) return;

    const target = deleteTarget;
    mutationLock.current = true;
    setMutationBusy(true);
    setMutationError('');
    try {
      const deletedId = await ordersClient.remove(target.order, requestId);
      ++loadSequence.current;
      setLoading(false);
      setLoadError('');
      setOrders(previous => previous.filter(order => order.id !== deletedId));
      setPendingMutation(null);
      setDeleteTarget(null);
      setSelectedOrder(null);
      setOrderFeedback('주문을 삭제했습니다.');
    } catch (error) {
      if (isUnknownWriteError(error)) {
        setPendingMutation({ kind: 'delete', order: target.order, requestId });
        setMutationError(UNKNOWN_WRITE_MESSAGE);
      } else {
        setPendingMutation(null);
        setMutationError(error.message);
        if (DEFINITIVE_NON_WRITE_CODES.has(error.code)) {
          setDeleteTarget(current => current ? { ...current, requestId: crypto.randomUUID() } : current);
        }
      }
    } finally {
      mutationLock.current = false;
      setMutationBusy(false);
    }
  };

  const retryPendingMutation = () => {
    if (mutationLock.current || !pendingMutation) return;
    if (pendingMutation.kind === 'save' && orderEditor?.requestId === pendingMutation.requestId) {
      saveOrder(pendingMutation.input, pendingMutation.requestId);
    } else if (pendingMutation.kind === 'delete' && deleteTarget?.requestId === pendingMutation.requestId) {
      confirmDelete(pendingMutation.requestId);
    }
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

  const handleDashboardToday = () => {
    const todayKey = getKSTDateKey();

    setViewDate(getCalendarDateFromKey(todayKey));
    setSelectedDate(todayKey);
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
    return Object.fromEntries(ORDER_TEXT_FIELDS.map(field => [
      field, groupOrderText(orders, field).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    ]));
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
    return list.filter(o => matchesOrderFilters(o, filters));
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
    const designCount = groupOrderText(statsOrders, 'design');
    const flavorCount = groupOrderText(statsOrders, 'flavor');
    const sheetCount = groupOrderText(statsOrders, 'sheet');
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
                 {filterOptions[type]?.length > 0 ? filterOptions[type].map(({ key: val, label }) => (
                   <div key={val} onClick={() => toggleFilter(type, val)} style={{ padding: '6px 12px', borderRadius: 'var(--radius-full)', fontSize: '12px', fontWeight: '600', cursor: 'pointer', backgroundColor: filters[type]?.includes(val) ? 'var(--point)' : 'var(--surface-soft)', color: filters[type]?.includes(val) ? 'white' : 'var(--text-sub)' }}>
                     {label}
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', marginBottom: '20px' }}>
          <button type="button" aria-label="이전 달" onClick={() => setViewDate(new Date(year, month - 2, 1))} style={{ justifySelf: 'start', width: '32px', height: '40px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px', fontWeight: 'bold' }}>&lt;</button>
          <div style={{ fontWeight: '900', fontSize: '16px', whiteSpace: 'nowrap', textAlign: 'center' }}>{year}년 {month}월</div>
          <button type="button" aria-label="다음 달" onClick={() => setViewDate(new Date(year, month, 1))} style={{ justifySelf: 'end', width: '32px', height: '40px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px', fontWeight: 'bold' }}>&gt;</button>
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
          <div className="dash-header-info" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div className="dash-date-summary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 4px 4px 16px', backgroundColor: 'var(--surface-soft)', borderRadius: 'var(--radius-full)', fontSize: '14px', fontWeight: '700' }}>
              <span style={{ color: 'var(--point)' }}>{activeTab === 'day' ? '하루 선택' : '기간 선택'}</span>
              <span className="dash-date-summary-value" style={{ color: 'var(--text-sub)' }}>
                {activeTab === 'day' ? selectedDate : `${startDate} - ${endDate}`}
              </span>
              <button className="calendar-today-btn" type="button" aria-label="오늘 날짜와 일별 보기로 이동" title="오늘 날짜와 일별 보기로 이동" onClick={handleDashboardToday}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4.5" width="18" height="16" rx="2" />
                  <path d="M16 2.5v4M8 2.5v4M3 9.5h18" />
                  <path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" />
                </svg>
                <span>오늘</span>
              </button>
            </div>
            <div className="dash-order-badge" style={{ fontSize: '14px', fontWeight: '800', color: 'var(--point)', backgroundColor: 'var(--point-light)', padding: '6px 12px', borderRadius: 'var(--radius-full)' }}>
              {dashboardOrders.length} 주문
            </div>
          </div>
          <div className="dash-header-actions" style={{ display: 'flex', gap: '8px' }}>
            {ORDER_API_ENABLED && (
              <button type="button" className="order-create-button" onClick={() => openOrderEditor()} disabled={mutationBusy || Boolean(pendingMutation)}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                주문 등록
              </button>
            )}
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
      const sortedItems = [...(countMap || [])].sort((a, b) => b.count - a.count);

      return (
        <div className="card" style={{ padding: '32px', borderTop: `4px solid ${color}`, borderRadius: '24px', backgroundColor: 'white', display: 'flex', flexDirection: 'column', transition: 'all 0.3s ease' }}>
          <h3 style={{ marginBottom: '24px', fontSize: '18px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{icon}</span> {title}
          </h3>
          <div className="flex flex-col gap-sm" style={{ flex: 1 }}>
            {sortedItems.map(({ key, label: name, count }, index) => {
              const isTop3 = index < 3;
              const rankColors = ['#F59E0B', '#9CA3AF', '#B45309']; // Gold, Silver, Bronze
              return (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line-soft)' }}>
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
        {isTestPage && (
          <div
            role="alert"
            style={{
              marginBottom: '24px',
              padding: '16px 20px',
              border: '2px solid #be123c',
              borderRadius: '16px',
              backgroundColor: '#fff1f2',
              color: '#881337',
              fontWeight: '700',
            }}
          >
            <strong style={{ display: 'block', marginBottom: '4px' }}>[테스트 전용·제작 금지] 테스트 시트</strong>
            <span>이 화면은 `/api/order-tests`만 사용하며 운영 시트 CSV fallback을 사용하지 않습니다. 모든 등록·수정·삭제는 테스트 문서에서만 수행됩니다.</span>
          </div>
        )}
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

        {orderFeedback && <div className="order-feedback" role="status"><span>{orderFeedback}</span><button type="button" aria-label="안내 닫기" onClick={() => setOrderFeedback('')}>×</button></div>}
        {loadError && <div className="order-feedback order-feedback--error" role="alert"><span>{loadError}</span><button type="button" onClick={() => loadSheetData(sheetInfo)}>다시 불러오기</button></div>}
        {activeMenu === 'dashboard' ? renderDashboard() : activeMenu === 'statistics' ? renderStatistics() : renderMyPage()}

        {showDetailModal && selectedOrder && (
          <OrderDetailModal
            order={selectedOrder}
            onClose={() => setShowDetailModal(false)}
            onCopy={handleCopy}
            copiedType={copiedType}
            editable={ORDER_API_ENABLED && canManageOrder(selectedOrder)}
            onEdit={() => openOrderEditor(selectedOrder)}
            onDelete={() => {
              if (pendingMutation) return;
              setMutationError('');
              setShowDetailModal(false);
              setDeleteTarget({ order: selectedOrder, requestId: crypto.randomUUID() });
            }}
          />
        )}
        {orderEditor && (
          <OrderFormModal
            key={orderEditor.editorKey}
            initialOrder={orderEditor.order}
            defaultDate={orderEditor.order ? getKSTDateKey() : selectedDate}
            options={Object.fromEntries(['design', 'flavor', 'sheet', 'size', 'cream', 'orderPath'].map(field => [field, [...new Set(orders.map(order => order[field]).filter(value => value && value !== '-'))]]))}
            onSave={saveOrder}
            onCancel={closeOrderEditor}
            busy={mutationBusy}
            pending={pendingMutation?.kind === 'save'}
            onRetry={retryPendingMutation}
            error={mutationError}
          />
        )}
        {deleteTarget && (
          <OrderDeleteModal
            order={deleteTarget.order}
            busy={mutationBusy}
            pending={pendingMutation?.kind === 'delete'}
            error={mutationError}
            onDelete={() => confirmDelete()}
            onRetry={retryPendingMutation}
            onClose={() => {
              if (mutationLock.current || pendingMutation) return;
              setDeleteTarget(null);
              setMutationError('');
              setShowDetailModal(true);
            }}
          />
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
