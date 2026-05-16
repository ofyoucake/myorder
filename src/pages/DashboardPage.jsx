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
  
  // Calendar View State
  const [viewDate, setViewDate] = useState(new Date());
  
  // Date Selection for Dashboard
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0].replace(/-/g, '.')); // yyyy.mm.dd
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Date Selection for Statistics
  const [statsStartDate, setStatsStartDate] = useState(null);
  const [statsEndDate, setStatsEndDate] = useState(null);
  const [showStatsDatePicker, setShowStatsDatePicker] = useState(false);

  // Filter State
  const [filters, setFilters] = useState({ design: [], sheet: [], size: [] });
  const [showFilterPicker, setShowFilterPicker] = useState(false);

  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);

  // Database Sync
  const [sheetInfo, setSheetInfo] = useState('');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

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
            const normalizedDate = dPart.split('.').map(p => p.padStart(2, '0')).join('.');

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
  };

  // Normalized compare helper
  const isDateInRange = (dateStr, start, end) => {
    if (!dateStr || !start || !end) return false;
    const d = new Date(dateStr.replace(/\./g, '-'));
    const s = new Date(start.replace(/\./g, '-'));
    const e = new Date(end.replace(/\./g, '-'));
    return d >= s && d <= e;
  };

  const filterOptions = useMemo(() => {
    const opts = { design: new Set(), sheet: new Set(), size: new Set() };
    orders.forEach(o => {
      if (o.design && o.design !== '-') opts.design.add(o.design);
      if (o.sheet && o.sheet !== '-') opts.sheet.add(o.sheet);
      if (o.size && o.size !== '-') opts.size.add(o.size);
    });
    return { design: [...opts.design].sort(), sheet: [...opts.sheet].sort(), size: [...opts.size].sort() };
  }, [orders]);

  const toggleFilter = (type, value) => {
    setFilters(prev => {
      const arr = prev[type];
      if (arr.includes(value)) return { ...prev, [type]: arr.filter(v => v !== value) };
      return { ...prev, [type]: [...arr, value] };
    });
  };

  const applyFilters = (list) => {
    return list.filter(o => {
      if (filters.design.length > 0 && !filters.design.includes(o.design)) return false;
      if (filters.sheet.length > 0 && !filters.sheet.includes(o.sheet)) return false;
      if (filters.size.length > 0 && !filters.size.includes(o.size)) return false;
      return true;
    });
  };

  const dashboardOrders = useMemo(() => {
    const normalizedSelected = selectedDate.split('.').map(p => p.padStart(2, '0')).join('.');
    let base = [];
    if (activeTab === 'day') {
      base = orders.filter(o => o.dateOnly === normalizedSelected);
    } else {
      if (!startDate || !endDate) return [];
      base = orders.filter(o => isDateInRange(o.dateOnly, startDate, endDate));
    }
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
    statsOrders.forEach(o => {
      designCount[o.design] = (designCount[o.design] || 0) + 1;
    });
    return { totalRevenue, totalCount: statsOrders.length, designCount };
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

  const renderFilterPopup = () => (
    <div className="filter-popup" style={{ position: 'absolute', top: 'calc(100% + 12px)', right: 0, width: '320px', backgroundColor: 'white', borderRadius: '24px', boxShadow: '0 25px 60px rgba(0,0,0,0.18)', border: '1px solid var(--line)', padding: '24px', zIndex: 2000 }}>
       <h4 style={{ fontWeight: '800', marginBottom: '16px' }}>상세 필터</h4>
       {['design', 'sheet', 'size'].map(type => (
         <div key={type} style={{ marginBottom: '16px' }}>
           <div style={{ fontSize: '12px', fontWeight: '800', color: 'var(--text-sub)', marginBottom: '8px' }}>
             {type === 'design' ? '디자인' : type === 'sheet' ? '시트' : '사이즈'}
           </div>
           <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
             {filterOptions[type].map(val => (
               <div key={val} onClick={() => toggleFilter(type, val)} style={{ padding: '6px 12px', borderRadius: 'var(--radius-full)', fontSize: '12px', fontWeight: '600', cursor: 'pointer', backgroundColor: filters[type].includes(val) ? 'var(--point)' : 'var(--surface-soft)', color: filters[type].includes(val) ? 'white' : 'var(--text-sub)' }}>
                 {val}
               </div>
             ))}
           </div>
         </div>
       ))}
    </div>
  );

  const renderCalendar = (type, currentStart, currentEnd, onSelect, inline = false) => {
    const days = getDaysInMonth(viewDate);
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth() + 1;
    
    const getTodayKST = () => {
      const now = new Date();
      const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
      return new Date(utc + (9 * 3600000));
    };
    const today = getTodayKST();

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
            const isInRange = type !== 'day' && currentStart && currentEnd && new Date(dateStr.replace(/\./g,'-')) > new Date(currentStart.replace(/\./g,'-')) && new Date(dateStr.replace(/\./g,'-')) < new Date(currentEnd.replace(/\./g,'-'));
            const isToday = date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
            
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
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div className="flex gap-sm" style={{ backgroundColor: 'var(--surface-soft)', padding: '4px', borderRadius: 'var(--radius-full)' }}>
              {['day', 'period'].map(tab => (
                <div key={tab} onClick={() => { setActiveTab(tab); setStartDate(null); setEndDate(null); }}
                  style={{ padding: '10px 24px', borderRadius: 'var(--radius-full)', cursor: 'pointer', backgroundColor: activeTab === tab ? 'white' : 'transparent', color: activeTab === tab ? 'var(--text-main)' : 'var(--text-sub)', fontWeight: '600', fontSize: '14px', boxShadow: activeTab === tab ? 'var(--shadow-elevation)' : 'none' }}>
                  {tab === 'day' ? '하루' : '기간'}
                </div>
              ))}
            </div>
            <div style={{ fontSize: '14px', fontWeight: '800', color: 'var(--point)', backgroundColor: 'var(--point-light)', padding: '6px 12px', borderRadius: 'var(--radius-full)' }}>
              {dashboardOrders.length} 주문
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div className="mobile-only" style={{ position: 'relative' }}>
              <div onClick={() => setShowDatePicker(!showDatePicker)} style={{ padding: '12px 24px', backgroundColor: 'white', border: '1px solid var(--line)', borderRadius: 'var(--radius-full)', cursor: 'pointer', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: 'var(--shadow-elevation)' }}>
                📅 {activeTab === 'day' ? selectedDate : (startDate && endDate ? `${startDate} - ${endDate}` : '기간 선택')}
              </div>
              {showDatePicker && renderCalendar(activeTab, startDate, endDate, (dateStr) => {
                if (activeTab === 'day') { setSelectedDate(dateStr); setShowDatePicker(false); }
                else {
                  if (!startDate || (startDate && endDate)) { setStartDate(dateStr); setEndDate(null); }
                  else {
                    if (new Date(dateStr.replace(/\./g,'-')) < new Date(startDate.replace(/\./g,'-'))) setStartDate(dateStr);
                    else { setEndDate(dateStr); setTimeout(() => setShowDatePicker(false), 300); }
                  }
                }
              })}
            </div>
            <div style={{ position: 'relative' }}>
              <div onClick={() => setShowFilterPicker(!showFilterPicker)} style={{ padding: '12px 24px', backgroundColor: 'white', border: '1px solid var(--line)', borderRadius: 'var(--radius-full)', cursor: 'pointer', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: 'var(--shadow-elevation)', color: (filters.design.length || filters.sheet.length || filters.size.length) ? 'var(--point)' : 'inherit' }}>
                ⚙️ 필터 {(filters.design.length || filters.sheet.length || filters.size.length) > 0 && `(${(filters.design.length + filters.sheet.length + filters.size.length)})`}
              </div>
              {showFilterPicker && renderFilterPopup()}
            </div>
          </div>
        </div>
        
        <div style={{ padding: '24px', minHeight: '400px' }}>
          {activeTab === 'day' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {Array.from({ length: 12 }, (_, i) => i + 9).map(hourNum => {
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
                          <div key={order.id} className="order-card-wrapper" style={{ 
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
                              items={[order.design]} 
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
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
                      {dashboardOrders.filter(o => o.dateOnly === date).map(o => <OrderCard key={o.id} time={o.time} customer={o.customer} items={[o.design]} color={o.time.includes(':30') ? '#3B82F6' : 'var(--point)'} onClick={() => handleOrderClick(o)} />)}
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

  const renderStatistics = () => (
    <div className="flex flex-col gap-md">
      <div className="card" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', overflow: 'visible' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800' }}>기간별 통계 조회</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div className="mobile-only" style={{ position: 'relative' }}>
            <div onClick={() => setShowStatsDatePicker(!showStatsDatePicker)} style={{ padding: '12px 24px', backgroundColor: 'white', border: '1px solid var(--line)', borderRadius: 'var(--radius-full)', cursor: 'pointer', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: 'var(--shadow-elevation)' }}>
              📅 {statsStartDate && statsEndDate ? `${statsStartDate} - ${statsEndDate}` : '통계 기간 선택'}
            </div>
            {showStatsDatePicker && renderCalendar('period', statsStartDate, statsEndDate, (dateStr) => {
              if (!statsStartDate || (statsStartDate && statsEndDate)) { setStatsStartDate(dateStr); setStatsEndDate(null); }
              else {
                if (new Date(dateStr.replace(/\./g,'-')) < new Date(statsStartDate.replace(/\./g,'-'))) setStatsStartDate(dateStr);
                else { setStatsEndDate(dateStr); setTimeout(() => setShowStatsDatePicker(false), 300); }
              }
            })}
          </div>
          <div style={{ position: 'relative' }}>
            <div onClick={() => setShowFilterPicker(!showFilterPicker)} style={{ padding: '12px 24px', backgroundColor: 'white', border: '1px solid var(--line)', borderRadius: 'var(--radius-full)', cursor: 'pointer', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: 'var(--shadow-elevation)', color: (filters.design.length || filters.sheet.length || filters.size.length) ? 'var(--point)' : 'inherit' }}>
              ⚙️ 필터 {(filters.design.length || filters.sheet.length || filters.size.length) > 0 && `(${(filters.design.length + filters.sheet.length + filters.size.length)})`}
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

      <div className="card" style={{ padding: '32px' }}>
        <h3 style={{ marginBottom: '24px', fontSize: '18px', fontWeight: '800' }}>인기 디자인 순위</h3>
        <div className="flex flex-col gap-sm">
          {Object.entries(statsData.designCount).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <span style={{ fontWeight: '600' }}>{name}</span>
              <span style={{ fontWeight: '800', color: 'var(--point)' }}>{count}건</span>
            </div>
          ))}
          {statsOrders.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-sub)' }}>조회된 데이터가 없습니다.</div>}
        </div>
      </div>
    </div>
  );

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

      <div className="main-content" style={{ flex: 1, marginLeft: '240px', padding: '48px', maxWidth: '1200px', paddingBottom: '100px' }}>
        <header className="header-actions" style={{ marginBottom: '48px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1 className="h1" style={{ fontSize: '32px' }}>{menuItems.find(i => i.id === activeMenu)?.label}</h1>
                <p className="text-sub" style={{ marginTop: '8px' }}>{session.user.email}님, 환영합니다!</p>
              </div>

              <div className="desktop-only" style={{ flex: 1, display: 'flex', justifyContent: 'center', margin: '0 24px' }}>
                {activeMenu === 'dashboard' && renderCalendar(
                  activeTab, startDate, endDate,
                  (dateStr) => {
                    if (activeTab === 'day') { setSelectedDate(dateStr); }
                    else {
                      if (!startDate || (startDate && endDate)) { setStartDate(dateStr); setEndDate(null); }
                      else {
                        if (new Date(dateStr.replace(/\./g,'-')) < new Date(startDate.replace(/\./g,'-'))) setStartDate(dateStr);
                        else { setEndDate(dateStr); }
                      }
                    }
                  },
                  true
                )}
                {activeMenu === 'statistics' && renderCalendar(
                  'period', statsStartDate, statsEndDate,
                  (dateStr) => {
                    if (!statsStartDate || (statsStartDate && statsEndDate)) { setStatsStartDate(dateStr); setStatsEndDate(null); }
                    else {
                      if (new Date(dateStr.replace(/\./g,'-')) < new Date(statsStartDate.replace(/\./g,'-'))) setStatsStartDate(dateStr);
                      else { setStatsEndDate(dateStr); }
                    }
                  },
                  true
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
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, backdropFilter: 'blur(10px)' }}>
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

                <div style={{ marginTop: '32px', textAlign: 'right' }}>
                  <Button onClick={() => setShowDetailModal(false)} size="large" style={{ width: '100%' }}>닫기</Button>
                </div>
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
