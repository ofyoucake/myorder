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
  const [statsRange, setStatsRange] = useState({ start: 1, end: 31 });
  const [showStatsPicker, setShowStatsPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState('2026.05.08');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);

  // My Page - Google Sheet Database Sync (Supabase)
  const [sheetInfo, setSheetInfo] = useState('');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  // Load profile (sheet_url) from Supabase
  useEffect(() => {
    const fetchProfile = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('sheet_url')
        .eq('id', session.user.id)
        .single();
      
      if (data && data.sheet_url) {
        setSheetInfo(data.sheet_url);
      } else if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows found"
        console.error('Error fetching profile:', error);
      }
    };
    fetchProfile();
  }, [session.user.id]);

  const handleSaveSheetInfo = async (url) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({ 
          id: session.user.id, 
          sheet_url: url,
          updated_at: new Date().toISOString()
        });
      
      if (error) throw error;
      setSheetInfo(url);
      alert('설정이 구름 위에(Supabase) 안전하게 저장되었습니다!');
    } catch (err) {
      alert('저장 실패: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadSheetData = useCallback(async (info) => {
    if (!info) {
      setOrders([]);
      return;
    }
    setLoading(true);
    try {
      let sheetId = info;
      if (info.includes('/d/')) {
        sheetId = info.split('/d/')[1].split('/')[0];
      }
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
      
      const response = await fetch(csvUrl);
      if (!response.ok) throw new Error('시트를 불러올 수 없습니다. 공유 설정을 확인해주세요.');
      
      const csvText = await response.text();
      
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const mappedOrders = results.data.map((row, index) => {
            const pickupDateRaw = row['픽업일자'] || '';
            const [datePart, timePart] = pickupDateRaw.includes(' ') ? pickupDateRaw.split(' ') : [pickupDateRaw, '00:00'];
            
            return {
              id: `sheet-${index}`,
              time: timePart || '00:00',
              customer: row['이름'] || '미지명',
              contact: row['연락처'] || '-',
              pickupDate: pickupDateRaw,
              dateOnly: datePart.replace(/\./g, '-'),
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
              color: index % 2 === 0 ? 'var(--point)' : 'var(--text-main)',
              dayOfWeek: datePart ? new Date(datePart.replace(/\./g, '-')).getDay() : 0
            };
          });
          setOrders(mappedOrders);
          setLoading(false);
        }
      });
    } catch (error) {
      console.error('Fetch error:', error);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSheetData(sheetInfo);
  }, [sheetInfo, loadSheetData]);

  const hours = Array.from({ length: 12 }, (_, i) => `${i + 9}:00`);
  const menuItems = [
    { id: 'dashboard', label: '대시보드' },
    { id: 'statistics', label: '통계 분석' },
    { id: 'mypage', label: '마이페이지' },
  ];

  const currentOrders = useMemo(() => {
    if (activeTab === 'day') {
      return orders.filter(o => o.pickupDate && o.pickupDate.includes(selectedDate));
    }
    if (startDate && endDate) {
      return orders.filter(o => {
        if (!o.pickupDate) return false;
        const d = parseInt(o.pickupDate.split('.')[2]);
        return d >= startDate && d <= endDate;
      });
    }
    return orders.filter(o => o.pickupDate && o.pickupDate.includes('2026.05.08'));
  }, [orders, activeTab, selectedDate, startDate, endDate]);

  const statsData = useMemo(() => {
    const filtered = orders.filter(o => {
      if (!o.pickupDate) return false;
      const d = parseInt(o.pickupDate.split('.')[2]);
      return d >= statsRange.start && d <= statsRange.end;
    });
    const totalRevenue = filtered.reduce((sum, o) => sum + o.price, 0);
    const totalCount = filtered.length;
    const designCount = {};
    const dailyRevenue = Array(32).fill(0);
    const dailyCount = Array(32).fill(0);
    const weekDayCount = Array(7).fill(0);
    
    filtered.forEach(o => {
      designCount[o.design] = (designCount[o.design] || 0) + 1;
      const d = parseInt(o.pickupDate.split('.')[2]);
      dailyRevenue[d] += o.price;
      dailyCount[d] += 1;
      weekDayCount[o.dayOfWeek] += 1;
    });
    
    return { totalRevenue, totalCount, designCount, dailyRevenue, dailyCount, weekDayCount, filtered };
  }, [orders, statsRange]);

  const renderMyPage = () => (
    <div className="flex flex-col gap-md">
      <div className="card" style={{ padding: '48px', maxWidth: '800px', border: 'none' }}>
        <h3 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '24px' }}>구글 스프레드시트 연동 설정</h3>
        <p style={{ color: 'var(--text-sub)', fontSize: '14px', marginBottom: '32px', lineHeight: '1.6' }}>
          연동할 구글 시트의 주소를 입력해주세요. 정보는 수파베이스 DB에 안전하게 보관됩니다.
        </p>
        <div className="flex flex-col gap-md">
          <Input 
            label="구글 시트 주소 (또는 ID)" 
            value={sheetInfo}
            onChange={(e) => setSheetInfo(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..." 
          />
          <div style={{ marginTop: '12px' }}>
            <Button onClick={() => handleSaveSheetInfo(sheetInfo)} size="large" disabled={loading}>
              {loading ? '저장 중...' : '설정 저장하기'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  const handleOrderClick = (order) => { setSelectedOrder(order); setShowDetailModal(true); };

  const renderDashboard = () => (
    <div className="flex flex-col gap-md">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <div className="card card-hover" style={{ padding: '24px 32px' }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-sub)' }}>선택된 주문 합계</div>
          <div style={{ fontSize: '32px', fontWeight: '800', marginTop: '8px', color: 'var(--text-main)' }}>{currentOrders.length}건</div>
        </div>
      </div>
      <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
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
              📅 {activeTab === 'day' ? selectedDate : (startDate && endDate ? `2026.05.${startDate} - 2026.05.${endDate}` : '기간을 선택하세요')}
            </div>
            {showDatePicker && (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '8px', width: '300px', backgroundColor: 'white', borderRadius: '16px', boxShadow: '0 15px 40px rgba(0,0,0,0.12)', border: '1px solid var(--line)', padding: '20px', zIndex: 1000 }}>
                <div style={{ textAlign: 'center', marginBottom: '16px', fontWeight: '800' }}>2026년 5월</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', fontSize: '12px' }}>
                  {Array.from({ length: 31 }, (_, i) => {
                    const day = i + 1;
                    const isSelected = activeTab === 'day' ? (selectedDate === `2026.05.${day < 10 ? '0' + day : day}`) : (day === startDate || day === endDate);
                    return (
                      <div key={day} onClick={() => { if (activeTab === 'day') { setSelectedDate(`2026.05.${day < 10 ? '0' + day : day}`); setShowDatePicker(false); } else { if (!startDate || (startDate && endDate)) { setStartDate(day); setEndDate(null); } else { setEndDate(day); setShowDatePicker(false); } } }}
                      style={{ padding: '10px 0', borderRadius: '8px', cursor: 'pointer', backgroundColor: isSelected ? 'var(--point)' : 'transparent', color: isSelected ? 'white' : 'var(--text-main)' }}>{day}</div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
        <div style={{ padding: '24px' }}>
          {loading && orders.length === 0 ? <div style={{ textAlign: 'center', padding: '40px' }}>데이터를 불러오는 중...</div> : (
            activeTab === 'day' ? (
              <div style={{ position: 'relative', display: 'flex', gap: '24px' }}>
                <div style={{ width: '60px' }}>{hours.map(h => <div key={h} style={{ height: '160px', fontSize: '13px', fontWeight: '700', borderRight: '2px solid var(--line)', textAlign: 'right', paddingRight: '12px' }}>{h}</div>)}</div>
                <div style={{ flex: 1, position: 'relative' }}>
                  {hours.map(h => <div key={h} style={{ height: '160px', borderBottom: '2px solid var(--line)', opacity: 0.5 }}></div>)}
                  {currentOrders.map(order => {
                    const [h, m] = order.time.split(':').map(Number);
                    const topOffset = (h - 9) * 160 + (m / 60) * 160;
                    return (
                      <div key={order.id} style={{ position: 'absolute', top: `${topOffset + 8}px`, width: '100%', zIndex: 2 }}>
                        <OrderCard {...order} onClick={() => handleOrderClick(order)} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
                {currentOrders.map(order => <OrderCard key={order.id} {...order} onClick={() => handleOrderClick(order)} />)}
              </div>
            )
          )}
        </div>
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
        <div style={{ position: 'absolute', bottom: '32px', width: '100%', padding: '0 24px' }}>
          <Button variant="secondary" onClick={onLogout} style={{ width: '100%', color: 'var(--error)' }}>로그아웃</Button>
        </div>
      </div>
      <div style={{ flex: 1, marginLeft: '240px', padding: '48px', maxWidth: '1200px' }}>
        <header style={{ marginBottom: '48px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h1 className="h1" style={{ fontSize: '32px' }}>{menuItems.find(i => i.id === activeMenu)?.label}</h1>
            <p className="text-sub" style={{ marginTop: '8px' }}>{session.user.email}님, 환영합니다!</p>
          </div>
          {activeMenu !== 'mypage' && <Button onClick={() => setShowOrderModal(true)} size="large">새 주문 등록</Button>}
        </header>
        {activeMenu === 'dashboard' ? renderDashboard() : activeMenu === 'statistics' ? renderStatistics() : renderMyPage()}
      </div>
    </div>
  );
};

export default DashboardPage;
