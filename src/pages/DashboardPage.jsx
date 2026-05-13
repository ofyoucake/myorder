import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { OrderCard } from '../components/OrderCard';
import { supabase } from '../supabaseClient';
import Papa from 'papaparse';

const DashboardPage = ({ session, onLogout }) => {
  // 1. State Management
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [activeTab, setActiveTab] = useState('day');
  
  // Calendar Navigation State
  const [viewDate, setViewDate] = useState(new Date(2026, 4, 8)); // Current viewing month in calendar
  
  const [statsRange, setStatsRange] = useState({ start: 1, end: 31 });
  const [showStatsPicker, setShowStatsPicker] = useState(false);
  
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState('2026.05.08');
  const [startDate, setStartDate] = useState(null); // String yyyy.mm.dd
  const [endDate, setEndDate] = useState(null); // String yyyy.mm.dd
  
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);

  // My Page - Google Sheet Database Sync
  const [sheetInfo, setSheetInfo] = useState('');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

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
      alert('저장 완료!');
    } catch (err) {
      alert('저장 실패: ' + err.message);
    } finally {
      setLoading(false);
    }
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
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const mapped = results.data.map((row, index) => {
            const pickupDateRaw = row['픽업일자'] || '';
            const [dPart, tPart] = pickupDateRaw.includes(' ') ? pickupDateRaw.split(' ') : [pickupDateRaw, '00:00'];
            return {
              id: `sheet-${index}`,
              time: tPart || '00:00',
              customer: row['이름'] || '미지명',
              contact: row['연락처'] || '-',
              pickupDate: pickupDateRaw,
              dateOnly: dPart, // yyyy.mm.dd
              orderDate: row['주문일자'] || '-',
              orderPath: row['주문경로'] || '-',
              items: [row['맛선택'], row['시트'], row['사이즈'], row['크림']].filter(Boolean),
              design: row['디자인'] || '-',
              flavor: row['맛선택'] || '-',
              sheet: row['시트'] || '-',
              size: row['사이즈'] || '-',
              cream: row['크림'] || '-',
              requests: row['요청사항'] || '-',
              specialNotes: row['특이사항'] || '-',
              price: parseInt((row['가격'] || '0').replace(/[^0-9]/g, '')) || 0,
            };
          });
          setOrders(mapped);
          setLoading(false);
        }
      });
    } catch (e) { setLoading(false); }
  }, []);

  useEffect(() => { loadSheetData(sheetInfo); }, [sheetInfo, loadSheetData]);

  // 2. Logic & Filtering
  const handleOrderClick = (order) => { 
    setSelectedOrder(order); 
    setShowDetailModal(true); 
  };

  const currentOrders = useMemo(() => {
    if (activeTab === 'day') {
      return orders.filter(o => o.dateOnly === selectedDate);
    } else {
      if (!startDate || !endDate) return [];
      const start = new Date(startDate.replace(/\./g, '-'));
      const end = new Date(endDate.replace(/\./g, '-'));
      return orders.filter(o => {
        const d = new Date(o.dateOnly.replace(/\./g, '-'));
        return d >= start && d <= end;
      });
    }
  }, [orders, activeTab, selectedDate, startDate, endDate]);

  const statsData = useMemo(() => {
    const start = statsRange.start;
    const end = statsRange.end;
    const filtered = orders.filter(o => {
      const d = parseInt(o.dateOnly.split('.')[2]);
      return d >= start && d <= end;
    });
    const totalRevenue = filtered.reduce((sum, o) => sum + o.price, 0);
    const dailyRevenue = Array(32).fill(0);
    const designCount = {};
    filtered.forEach(o => {
      designCount[o.design] = (designCount[o.design] || 0) + 1;
      dailyRevenue[parseInt(o.dateOnly.split('.')[2])] += o.price;
    });
    return { totalRevenue, totalCount: filtered.length, designCount, dailyRevenue };
  }, [orders, statsRange]);

  // 3. Calendar Helper
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

  // 4. Renderers
  const renderCalendar = (type) => {
    const days = getDaysInMonth(viewDate);
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth() + 1;

    return (
      <div style={{ position: 'absolute', top: 'calc(100% + 12px)', right: 0, width: '320px', backgroundColor: 'white', borderRadius: '24px', boxShadow: '0 25px 60px rgba(0,0,0,0.18)', border: '1px solid var(--line)', padding: '24px', zIndex: 2000 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <button onClick={() => setViewDate(new Date(year, month - 2, 1))} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px', fontWeight: 'bold' }}>&lt;</button>
          <div style={{ fontWeight: '900', fontSize: '16px' }}>{year}년 {month}월</div>
          <button onClick={() => setViewDate(new Date(year, month, 1))} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px', fontWeight: 'bold' }}>&gt;</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', marginBottom: '8px' }}>
          {['일','월','화','수','목','금','토'].map((d, i) => <div key={d} style={{ fontSize: '12px', fontWeight: '700', color: i === 0 ? 'var(--error)' : 'var(--text-sub)', opacity: 0.5 }}>{d}</div>)}
          {days.map((date, i) => {
            if (!date) return <div key={`empty-${i}`} />;
            const dateStr = formatDate(date);
            const isSelected = type === 'day' ? selectedDate === dateStr : (dateStr === startDate || dateStr === endDate);
            const isInRange = type === 'period' && startDate && endDate && new Date(dateStr.replace(/\./g,'-')) > new Date(startDate.replace(/\./g,'-')) && new Date(dateStr.replace(/\./g,'-')) < new Date(endDate.replace(/\./g,'-'));
            
            return (
              <div key={dateStr} onClick={() => {
                if (type === 'day') {
                  setSelectedDate(dateStr);
                  setShowDatePicker(false);
                } else {
                  if (!startDate || (startDate && endDate)) {
                    setStartDate(dateStr); setEndDate(null);
                  } else {
                    if (new Date(dateStr.replace(/\./g,'-')) < new Date(startDate.replace(/\./g,'-'))) {
                      setStartDate(dateStr);
                    } else {
                      setEndDate(dateStr);
                      setTimeout(() => setShowDatePicker(false), 300);
                    }
                  }
                }
              }}
              style={{ padding: '10px 0', borderRadius: '12px', cursor: 'pointer', fontSize: '13px', fontWeight: '700', backgroundColor: isSelected ? 'var(--point)' : (isInRange ? 'var(--point-light)' : 'transparent'), color: isSelected ? 'white' : (isInRange ? 'var(--point)' : 'var(--text-main)') }}>
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
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="flex gap-sm" style={{ backgroundColor: 'var(--surface-soft)', padding: '4px', borderRadius: 'var(--radius-full)' }}>
            {['day', 'period'].map(tab => (
              <div key={tab} onClick={() => { setActiveTab(tab); setStartDate(null); setEndDate(null); }}
                style={{ padding: '10px 24px', borderRadius: 'var(--radius-full)', cursor: 'pointer', backgroundColor: activeTab === tab ? 'white' : 'transparent', color: activeTab === tab ? 'var(--text-main)' : 'var(--text-sub)', fontWeight: '600', fontSize: '14px', boxShadow: activeTab === tab ? 'var(--shadow-elevation)' : 'none' }}>
                {tab === 'day' ? '하루' : '기간'}
              </div>
            ))}
          </div>
          <div style={{ position: 'relative' }}>
            <div onClick={() => setShowDatePicker(!showDatePicker)} style={{ padding: '12px 24px', backgroundColor: 'white', border: '1px solid var(--line)', borderRadius: 'var(--radius-full)', cursor: 'pointer', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: 'var(--shadow-elevation)' }}>
              📅 {activeTab === 'day' ? selectedDate : (startDate && endDate ? `${startDate} - ${endDate}` : '기간 선택')}
            </div>
            {showDatePicker && renderCalendar(activeTab)}
          </div>
        </div>
        
        <div style={{ padding: '24px', minHeight: '400px' }}>
          {activeTab === 'day' ? (
            <div style={{ position: 'relative', display: 'flex', gap: '24px' }}>
              <div style={{ width: '60px' }}>
                {Array.from({ length: 12 }, (_, i) => `${i + 9}:00`).map(h => <div key={h} style={{ height: '160px', fontSize: '13px', fontWeight: '700', borderRight: '2px solid var(--line)', textAlign: 'right', paddingRight: '12px' }}>{h}</div>)}
              </div>
              <div style={{ flex: 1, position: 'relative' }}>
                {Array.from({ length: 12 }, (_, i) => `${i + 9}:00`).map(h => <div key={h} style={{ height: '160px', borderBottom: '2px solid var(--line)', opacity: 0.5 }}></div>)}
                {currentOrders.map(order => {
                  const [h, m] = order.time.split(':').map(Number);
                  const topOffset = (h - 9) * 160 + (m / 60) * 160;
                  const sameTimeOrders = currentOrders.filter(o => o.time === order.time);
                  const n = sameTimeOrders.length;
                  const idx = sameTimeOrders.findIndex(o => o.id === order.id);
                  return (
                    <div key={order.id} style={{ position: 'absolute', top: `${topOffset + 8}px`, left: `${(idx / n) * 100}%`, width: `calc(${100 / n}% - 8px)`, zIndex: 2 }}>
                      <OrderCard {...order} onClick={() => handleOrderClick(order)} />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
              {Array.from(new Set(currentOrders.map(o => o.dateOnly))).sort().map(date => (
                <div key={date} className="flex flex-col gap-md">
                  <h3 style={{ fontSize: '16px', fontWeight: '800' }}>{date}</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
                    {currentOrders.filter(o => o.dateOnly === date).map(o => <OrderCard key={o.id} {...o} onClick={() => handleOrderClick(o)} />)}
                  </div>
                </div>
              ))}
              {currentOrders.length === 0 && <div style={{ textAlign: 'center', padding: '100px', color: 'var(--text-sub)' }}>선택한 기간에 주문이 없습니다.</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-main)' }}>
      {/* Sidebar */}
      <div className="sidebar">
        <div style={{ padding: '0 24px', marginBottom: '32px' }}><h2 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--point)' }}>MyOrder</h2></div>
        <nav className="flex flex-col" style={{ padding: '0 16px' }}>
          {menuItems.map(item => (
            <div key={item.id} onClick={() => setActiveMenu(item.id)} className={`nav-item ${activeMenu === item.id ? 'active' : ''}`} style={{ padding: '14px 20px', borderRadius: '12px', cursor: 'pointer', marginBottom: '4px', fontWeight: '700' }}>{item.label}</div>
          ))}
        </nav>
        <div style={{ position: 'absolute', bottom: '32px', width: '100%', padding: '0 24px' }}><Button variant="secondary" onClick={onLogout} style={{ width: '100%', color: 'var(--error)' }}>로그아웃</Button></div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, marginLeft: '240px', padding: '48px', maxWidth: '1200px' }}>
        <header style={{ marginBottom: '48px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h1 className="h1" style={{ fontSize: '32px' }}>{menuItems.find(i => i.id === activeMenu)?.label}</h1>
            <p className="text-sub" style={{ marginTop: '8px' }}>{session.user.email}님, 환영합니다!</p>
          </div>
          {activeMenu !== 'mypage' && <Button size="large">새 주문 등록</Button>}
        </header>

        {activeMenu === 'dashboard' ? renderDashboard() : activeMenu === 'mypage' ? renderMyPage() : <div className="card" style={{ padding: '100px', textAlign: 'center' }}>준비 중인 서비스입니다.</div>}

        {/* Detail Modal */}
        {showDetailModal && selectedOrder && (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, backdropFilter: 'blur(10px)' }}>
            <div className="card" style={{ width: '100%', maxWidth: '650px', padding: '40px', borderRadius: '32px', position: 'relative', border: 'none', animation: 'slideUp 0.3s ease-out' }}>
              <button onClick={() => setShowDetailModal(false)} style={{ position: 'absolute', top: '30px', right: '30px', border: 'none', background: 'none', fontSize: '24px', cursor: 'pointer', opacity: 0.4 }}>×</button>
              <h2 style={{ fontSize: '24px', fontWeight: '800', marginBottom: '32px' }}>주문 상세 내역</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>고객명</label><div style={{ fontSize: '16px', fontWeight: '600' }}>{selectedOrder.customer}</div></div>
                  <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>연락처</label><div style={{ fontSize: '16px', fontWeight: '600' }}>{selectedOrder.contact}</div></div>
                  <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>픽업일시</label><div style={{ fontSize: '16px', fontWeight: '600' }}>{selectedOrder.pickupDate}</div></div>
                  <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>가격</label><div style={{ fontSize: '16px', fontWeight: '600' }}>{selectedOrder.price.toLocaleString()}원</div></div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>디자인</label><div style={{ fontSize: '16px', fontWeight: '600' }}>{selectedOrder.design}</div></div>
                  <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>상세내용</label><div style={{ fontSize: '14px', fontWeight: '500', lineHeight: '1.4' }}>{selectedOrder.items.join(', ')}</div></div>
                  <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>요청사항</label><div style={{ fontSize: '14px', fontWeight: '500' }}>{selectedOrder.requests}</div></div>
                  <div><label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-sub)' }}>특이사항</label><div style={{ fontSize: '14px', fontWeight: '500' }}>{selectedOrder.specialNotes}</div></div>
                </div>
              </div>
              <div style={{ marginTop: '40px', textAlign: 'right' }}>
                <Button onClick={() => setShowDetailModal(false)}>확인</Button>
              </div>
            </div>
          </div>
        )}
      </div>
      <style>{`
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>
    </div>
  );
};

export default DashboardPage;
