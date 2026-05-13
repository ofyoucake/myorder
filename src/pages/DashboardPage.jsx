import React, { useState, useMemo, useEffect } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { OrderCard } from '../components/OrderCard';
import Papa from 'papaparse';

const DashboardPage = ({ onLogout }) => {
  // 1. State Management
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [activeTab, setActiveTab] = useState('day');
  
  // Statistics Date Range (defaults to full month of May)
  const [statsRange, setStatsRange] = useState({ start: 1, end: 31 });
  const [showStatsPicker, setShowStatsPicker] = useState(false);
  
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState('2026.05.08');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);

  // My Page - Google Sheet Persistence
  const [sheetInfo, setSheetInfo] = useState(() => localStorage.getItem('myorder_sheet_url') || '');

  const handleSaveSheetInfo = (url) => {
    localStorage.setItem('myorder_sheet_url', url);
    setSheetInfo(url);
    alert('구글 시트 정보가 안전하게 저장되었습니다.');
  };

  const hours = Array.from({ length: 12 }, (_, i) => `${i + 9}:00`);

  const menuItems = [
    { id: 'dashboard', label: '대시보드' },
    { id: 'statistics', label: '통계 분석' },
    { id: 'mypage', label: '마이페이지' },
  ];

  // 2. Real Data Management (Google Sheets)
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadSheetData = React.useCallback(async (info) => {
    if (!info) return;
    setLoading(true);
    try {
      let sheetId = info;
      if (info.includes('/d/')) {
        sheetId = info.split('/d/')[1].split('/')[0];
      }
      // Export as CSV for public sheets
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
      
      const response = await fetch(csvUrl);
      if (!response.ok) throw new Error('시트를 불러올 수 없습니다. 공유 설정을 확인해주세요.');
      
      const csvText = await response.text();
      
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const mappedOrders = results.data.map((row, index) => {
            // User Mapping: A=이름, B=디자인, C=주문일자, D=픽업일자, E=맛선택, F=시트, G=사이즈, H=크림, I=요청사항, J=특이사항, K=주문경로, L=연락처, M=가격
            const pickupDateRaw = row['픽업일자'] || ''; // yyyy.mm.dd 00:00
            const [datePart, timePart] = pickupDateRaw.includes(' ') ? pickupDateRaw.split(' ') : [pickupDateRaw, '00:00'];
            
            return {
              id: `sheet-${index}`,
              time: timePart || '00:00',
              customer: row['이름'] || '미지명',
              contact: row['연락처'] || '-',
              pickupDate: pickupDateRaw,
              dateOnly: datePart.replace(/\./g, '-'), // yyyy-mm-dd for filtering
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
        },
        error: (err) => {
          console.error('Parsing error:', err);
          setLoading(false);
        }
      });
    } catch (error) {
      console.error('Fetch error:', error);
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (sheetInfo) {
      loadSheetData(sheetInfo);
    }
  }, [sheetInfo, loadSheetData]);

  // 3. Filtering Logic for Dashboard
  const currentOrders = useMemo(() => {
    if (activeTab === 'day') {
      return orders.filter(o => o.pickupDate && o.pickupDate.includes(selectedDate));
    }
    if (startDate && endDate) {
      return orders.filter(o => {
        if (!o.pickupDate) return false;
        const d = parseInt(o.pickupDate.split('.')[2]); // yyyy.mm.dd format
        return d >= startDate && d <= endDate;
      });
    }
    return orders.filter(o => o.pickupDate && o.pickupDate.includes('2026.05.08'));
  }, [orders, activeTab, selectedDate, startDate, endDate]);

  const handleOrderClick = (order) => { setSelectedOrder(order); setShowDetailModal(true); };

  // 4. Statistics Calculation (Linked to statsRange)
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

  // --- Sub-components & Renderers ---

  const DetailField = ({ label, value }) => (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ fontSize: '12px', color: 'var(--text-sub)', fontWeight: '700', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '15px', color: 'var(--text-main)', fontWeight: '600', backgroundColor: 'var(--surface-soft)', padding: '10px 14px', borderRadius: '8px' }}>{value || '-'}</div>
    </div>
  );

  const renderStatistics = () => {
    const { totalRevenue, totalCount, designCount, dailyRevenue, dailyCount, weekDayCount } = statsData;
    const maxDailyRev = Math.max(...dailyRevenue) || 1;
    const maxWeekCount = Math.max(...weekDayCount) || 1;

    return (
      <div className="flex flex-col gap-md">
        {/* Stats Header with Date Filter */}
        <div className="card" style={{ padding: '20px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontWeight: '800', color: 'var(--text-main)', fontSize: '18px' }}>분석 기간 선택</span>
          </div>
          <div style={{ position: 'relative' }}>
            <div onClick={() => setShowStatsPicker(!showStatsPicker)} style={{ padding: '12px 24px', backgroundColor: 'white', border: '1px solid var(--line)', borderRadius: 'var(--radius-full)', cursor: 'pointer', fontWeight: '600', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: 'var(--shadow-elevation)' }}>
              📅 {statsRange.start}일 ~ {statsRange.end || statsRange.start}일
            </div>
            {showStatsPicker && (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '12px', width: '300px', backgroundColor: 'white', borderRadius: '20px', boxShadow: '0 20px 50px rgba(0,0,0,0.15)', border: '1px solid var(--line)', padding: '24px', zIndex: 1000 }}>
                <div style={{ textAlign: 'center', marginBottom: '16px', fontWeight: '900' }}>분석 기간 설정</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center' }}>
                  {['일', '월', '화', '수', '목', '금', '토'].map(d => <div key={d} style={{ fontSize: '12px', opacity: 0.4, paddingBottom: '8px' }}>{d}</div>)}
                  {Array.from({ length: 31 }, (_, i) => {
                    const day = i + 1;
                    const isSelected = day === statsRange.start || day === statsRange.end;
                    const isInRange = day > statsRange.start && day < statsRange.end;
                    return (
                      <div key={day} onClick={() => {
                        if (!statsRange.start || (statsRange.start && statsRange.end)) {
                          setStatsRange({ start: day, end: null });
                        } else {
                          if (day < statsRange.start) {
                            setStatsRange({ start: day, end: null });
                          } else {
                            setStatsRange({ ...statsRange, end: day });
                            setTimeout(() => setShowStatsPicker(false), 300);
                          }
                        }
                      }}
                      style={{ padding: '10px 0', borderRadius: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: '700', backgroundColor: isSelected ? 'var(--point)' : (isInRange ? 'var(--point-light)' : 'transparent'), color: isSelected ? 'white' : (isInRange ? 'var(--point)' : 'var(--text-main)') }}>{day}</div>
                    );
                  })}
                </div>
                <Button onClick={() => setShowStatsPicker(false)} style={{ width: '100%', marginTop: '20px' }} size="compact">닫기</Button>
              </div>
            )}
          </div>
        </div>

        {/* Stats Summary Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
          <div className="card card-hover" style={{ padding: '32px', border: '1px solid var(--line)', textAlign: 'center' }}>
            <div style={{ fontSize: '14px', color: 'var(--text-sub)', fontWeight: '600' }}>선택 기간 판매량</div>
            <div style={{ fontSize: '36px', fontWeight: '800', color: 'var(--text-main)', marginTop: '8px' }}>{totalCount}개</div>
          </div>
          <div className="card card-hover" style={{ padding: '32px', border: '1px solid var(--line)', textAlign: 'center' }}>
            <div style={{ fontSize: '14px', color: 'var(--text-sub)', fontWeight: '600' }}>선택 기간 매출액</div>
            <div style={{ fontSize: '36px', fontWeight: '800', color: 'var(--text-main)', marginTop: '8px' }}>{totalRevenue.toLocaleString()}원</div>
          </div>
          <div className="card" style={{ padding: '32px', border: 'none' }}>
            <div style={{ fontSize: '14px', color: 'var(--text-sub)', fontWeight: '700', textAlign: 'center', marginBottom: '16px' }}>디자인별 판매 현황</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '150px', overflowY: 'auto', paddingRight: '8px' }}>
              {Object.entries(designCount).sort((a,b) => b[1] - a[1]).map(([name, count], i) => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px', fontWeight: '700' }}>
                  <span style={{ color: i < 3 ? 'var(--point)' : 'var(--text-main)' }}>{i+1}. {name}</span>
                  <span style={{ color: 'var(--text-sub)' }}>{count}건</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
          <div className="card" style={{ padding: '32px', border: 'none' }}>
            <h3 style={{ marginBottom: '32px', fontSize: '16px', fontWeight: '800' }}>일자별 매출 추이</h3>
            <div style={{ display: 'flex', alignItems: 'flex-end', height: '220px', gap: '4px', paddingBottom: '20px', borderBottom: '1.5px solid var(--line)' }}>
              {dailyRevenue.slice(statsRange.start, (statsRange.end || statsRange.start) + 1).map((rev, i) => (
                <div key={i} title={`${statsRange.start + i}일: ${rev.toLocaleString()}원`} style={{ flex: 1, backgroundColor: 'var(--point)', height: `${(rev / maxDailyRev) * 100}%`, minHeight: '2px', opacity: 0.8, borderRadius: '4px 4px 0 0' }}></div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', fontSize: '11px', fontWeight: '700', color: 'var(--text-sub)' }}>
              <span>{statsRange.start}일</span>
              <span>{Math.floor((statsRange.start + (statsRange.end || statsRange.start)) / 2)}일</span>
              <span>{statsRange.end || statsRange.start}일</span>
            </div>
          </div>
          <div className="card" style={{ padding: '32px', border: 'none' }}>
            <h3 style={{ marginBottom: '32px', fontSize: '16px', fontWeight: '800' }}>요일별 판매 분포</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {['일','월','화','수','목','금','토'].map((day, i) => (
                <div key={day} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ width: '24px', fontSize: '13px', fontWeight: '800', color: i === 0 ? 'var(--error)' : 'var(--text-main)' }}>{day}</span>
                  <div style={{ flex: 1, height: '12px', backgroundColor: 'var(--surface-soft)', borderRadius: '6px', overflow: 'hidden' }}>
                    <div style={{ width: `${(weekDayCount[i] / maxWeekCount) * 100}%`, height: '100%', backgroundColor: i === 0 || i === 6 ? 'var(--error)' : 'var(--point)', opacity: 0.8 }}></div>
                  </div>
                  <span style={{ width: '30px', fontSize: '11px', fontWeight: '700', textAlign: 'right' }}>{weekDayCount[i]}건</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderMyPage = () => (
    <div className="flex flex-col gap-md">
      <div className="card" style={{ padding: '48px', maxWidth: '800px', border: 'none' }}>
        <h3 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '24px' }}>구글 스프레드시트 연동 설정</h3>
        <p style={{ color: 'var(--text-sub)', fontSize: '14px', marginBottom: '32px', lineHeight: '1.6' }}>
          연동할 구글 시트의 주소(URL) 또는 ID를 입력해주세요.<br />
          반드시 구글 시트 공유 설정에서 <strong style={{ color: 'var(--point)' }}>'링크가 있는 모든 사용자에게 뷰어'</strong> 이상의 권한이 부여되어 있어야 합니다.
        </p>
        
        <div className="flex flex-col gap-md">
          <div style={{ width: '100%' }}>
            <Input 
              label="구글 시트 주소 (또는 ID)" 
              value={sheetInfo}
              onChange={(e) => setSheetInfo(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..." 
            />
          </div>
          <div style={{ marginTop: '12px' }}>
            <Button onClick={() => handleSaveSheetInfo(sheetInfo)} size="large">설정 저장하기</Button>
          </div>
        </div>

        <div style={{ marginTop: '48px', padding: '24px', backgroundColor: 'var(--surface-soft)', borderRadius: '16px', border: '1px solid var(--line)' }}>
          <h4 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '12px' }}>💡 도움말: 시트 ID 찾는 법</h4>
          <p style={{ fontSize: '13px', color: 'var(--text-sub)', lineHeight: '1.6' }}>
            시트 주소창에서 <code>/d/</code> 와 <code>/edit</code> 사이에 있는 긴 문자열이 시트 ID입니다.<br />
            예: <code>https://docs.google.com/spreadsheets/d/<strong style={{ color: 'var(--text-main)' }}>1A2B3C...XYZ</strong>/edit</code>
          </p>
        </div>
      </div>
    </div>
  );

  const renderDashboard = () => (
    <div className="flex flex-col gap-md">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <div className="card card-hover" style={{ padding: '24px 32px' }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-sub)' }}>선택된 주문 합계</div>
          <div style={{ fontSize: '32px', fontWeight: '800', marginTop: '8px', color: 'var(--text-main)' }}>{currentOrders.length}건</div>
        </div>
      </div>
      <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 20 }}>
          <div className="flex gap-sm" style={{ backgroundColor: 'var(--surface-soft)', padding: '4px', borderRadius: 'var(--radius-full)' }}>
            {['day', 'period'].map(tab => (
              <div key={tab} onClick={() => { setActiveTab(tab); setStartDate(null); setEndDate(null); }}
                style={{ padding: '10px 24px', borderRadius: 'var(--radius-full)', cursor: 'pointer', backgroundColor: activeTab === tab ? 'white' : 'transparent', color: activeTab === tab ? 'var(--text-main)' : 'var(--text-sub)', fontWeight: '600', fontSize: '14px', boxShadow: activeTab === tab ? 'var(--shadow-elevation)' : 'none', transition: 'all 0.2s' }}>
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
                  {['일', '월', '화', '수', '목', '금', '토'].map(d => <div key={d} style={{ opacity: 0.4 }}>{d}</div>)}
                  {Array.from({ length: 31 }, (_, i) => {
                    const day = i + 1;
                    const isSelected = activeTab === 'day' ? (selectedDate === `2026.05.${day < 10 ? '0' + day : day}`) : (day === startDate || day === endDate);
                    const isInRange = activeTab === 'period' && startDate && endDate && day > startDate && day < endDate;
                    return (
                      <div key={day} onClick={() => { if (activeTab === 'day') { setSelectedDate(`2026.05.${day < 10 ? '0' + day : day}`); setShowDatePicker(false); } else { if (!startDate || (startDate && endDate)) { setStartDate(day); setEndDate(null); } else { if (day < startDate) setStartDate(day); else { setEndDate(day); setTimeout(() => setShowDatePicker(false), 300); } } } }}
                      style={{ padding: '10px 0', borderRadius: '8px', cursor: 'pointer', backgroundColor: isSelected ? 'var(--point)' : (isInRange ? 'var(--point-light)' : 'transparent'), color: isSelected ? 'white' : (isInRange ? 'var(--point)' : 'var(--text-main)') }}>{day}</div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
        <div style={{ padding: '24px' }}>
          {activeTab === 'day' ? (
            <div style={{ position: 'relative', display: 'flex', gap: '24px' }}>
              <div style={{ width: '60px' }}>
                {hours.map(h => <div key={h} style={{ height: '160px', fontSize: '13px', fontWeight: '700', borderRight: '2px solid var(--line)', textAlign: 'right', paddingRight: '12px' }}>{h}</div>)}
              </div>
              <div style={{ flex: 1, position: 'relative' }}>
                {hours.map(h => <div key={h} style={{ height: '160px', borderBottom: '2px solid var(--line)', opacity: 0.5 }}></div>)}
                {currentOrders.map(order => {
                  const [h, m] = order.time.split(':').map(Number);
                  const topOffset = (h - 9) * 160 + (m / 60) * 160;
                  const sameTimeOrders = currentOrders.filter(o => o.time === order.time);
                  const orderIndex = sameTimeOrders.findIndex(o => o.id === order.id);
                  const n = sameTimeOrders.length;
                  return (
                    <div key={order.id} style={{ position: 'absolute', top: `${topOffset + 8}px`, left: `${(orderIndex/n)*100}%`, width: `calc(${100/n}% - 12px)`, zIndex: 2 }}>
                      <OrderCard {...order} onClick={() => handleOrderClick(order)} />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
              {Array.from(new Set(currentOrders.map(o => o.pickupDate.split(' ')[0]))).sort().map((dateStr, idx) => (
                <div key={idx} className="flex flex-col gap-md">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: '800' }}>{dateStr}</h3>
                    <div style={{ flex: 1, height: '1.5px', backgroundColor: 'var(--line)', opacity: 0.5 }}></div>
                    <span style={{ fontSize: '12px', color: 'var(--text-sub)', fontWeight: '700' }}>
                      {currentOrders.filter(o => o.pickupDate.includes(dateStr)).length}건
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
                    {currentOrders.filter(o => o.pickupDate.includes(dateStr)).map(order => <OrderCard key={order.id} {...order} onClick={() => handleOrderClick(order)} />)}
                  </div>
                </div>
              ))}
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
        <div style={{ padding: '0 24px', marginBottom: '32px' }}><h2 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--point)', letterSpacing: '-0.5px' }}>MyOrder</h2></div>
        <nav className="flex flex-col" style={{ padding: '0 16px' }}>
          {menuItems.map(item => (
            <div key={item.id} onClick={() => setActiveMenu(item.id)} 
              className={`nav-item ${activeMenu === item.id ? 'active' : ''}`} 
              style={{ padding: '14px 20px', borderRadius: '12px', cursor: 'pointer', marginBottom: '4px', fontWeight: '700' }}>
              {item.label}
            </div>
          ))}
        </nav>
        <div style={{ position: 'absolute', bottom: '32px', width: '100%', padding: '0 24px' }}>
          <Button variant="secondary" onClick={onLogout} style={{ width: '100%', color: 'var(--error)' }}>로그아웃</Button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, marginLeft: '240px', padding: '48px', maxWidth: '1200px' }}>
        <header style={{ marginBottom: '48px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h1 className="h1" style={{ fontSize: '32px' }}>{menuItems.find(i => i.id === activeMenu)?.label}</h1>
            <p className="text-sub" style={{ marginTop: '8px' }}>
              {activeMenu === 'dashboard' ? '매장 예약을 한눈에 확인하세요.' : 
               activeMenu === 'statistics' ? '데이터로 매장 성과를 분석하세요.' : 
               '계정 설정 및 외부 데이터 연동을 관리하세요.'}
            </p>
          </div>
          {activeMenu !== 'mypage' && <Button onClick={() => setShowOrderModal(true)} size="large">새 주문 등록</Button>}
        </header>

        {activeMenu === 'dashboard' ? renderDashboard() : 
         activeMenu === 'statistics' ? renderStatistics() : 
         activeMenu === 'mypage' ? renderMyPage() : 
         <div className="card" style={{ padding: '100px', textAlign: 'center' }}>준비 중인 서비스입니다.</div>}

        {/* Detail Modal */}
        {showDetailModal && selectedOrder && (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, backdropFilter: 'blur(8px)' }}>
            <div className="card" style={{ width: '100%', maxWidth: '750px', padding: '48px', borderRadius: '32px', position: 'relative', border: 'none' }}>
              <button onClick={() => setShowDetailModal(false)} style={{ position: 'absolute', top: '40px', right: '40px', border: 'none', background: 'none', fontSize: '28px', cursor: 'pointer', opacity: 0.3 }}>×</button>
              <h3 className="h1" style={{ marginBottom: '40px', fontSize: '28px' }}>주문 상세 정보</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
                <div>
                  <DetailField label="고객명" value={selectedOrder.customer} />
                  <DetailField label="연락처" value={selectedOrder.contact} />
                  <DetailField label="주문 경로" value={selectedOrder.orderPath} />
                  <DetailField label="픽업 일시" value={selectedOrder.pickupDate} />
                </div>
                <div>
                  <DetailField label="디자인" value={selectedOrder.design} />
                  <DetailField label="맛/시트/사이즈" value={`${selectedOrder.flavor} / ${selectedOrder.sheet} / ${selectedOrder.size}`} />
                  <DetailField label="요청사항" value={selectedOrder.requests} />
                  <DetailField label="특이사항" value={selectedOrder.specialNotes} />
                </div>
              </div>
              <div style={{ marginTop: '48px', display: 'flex', gap: '16px', justifyContent: 'flex-end' }}>
                <Button variant="secondary" onClick={() => setShowDetailModal(false)} style={{ width: '120px' }}>닫기</Button>
                <Button style={{ width: '160px' }}>주문 수정</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardPage;
