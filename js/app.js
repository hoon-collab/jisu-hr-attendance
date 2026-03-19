// ============ 사용자 정보 (OAuth 로그인 후 설정) ============
var userEmail = '';
var userRole = '';
var userName = '';
var userOrg = '';

// ============ 전역 변수 ============
var allEmployees = [];
var filteredEmployees = [];
var allTemplates = [];
var todayAttendance = [];
var myStatus = null;
var organizations = [];
var leaveTypes = [];
var attendanceStatusList = [];
var pendingLeavesCount = 0;
var currentPage = 'dashboard';
var calendarYear = new Date().getFullYear();
var calendarMonth = new Date().getMonth() + 1;
var currentLeaveTab = 'my';
var currentPayrollTab = 'my';
var _cache = {};
var canPayrollAdmin = false;

// ============ 성능 유틸리티 ============
function debounce_(fn, delay) {
  var timer = null;
  return function() {
    var args = arguments;
    var context = this;
    clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(context, args); }, delay);
  };
}

// 페이지 데이터 캐시 (네비게이션 간 재사용)
var _pageDataCache = {};
var _pageDirty = {};
function markPageDirty_(page) { _pageDirty[page] = true; }
function isPageDirty_(page) { return !!_pageDirty[page]; }
function clearPageDirty_(page) { _pageDirty[page] = false; }

// 디바운스된 검색 핸들러
var debouncedApplyEmployeeFilters = debounce_(function() { applyEmployeeFilters(); }, 200);
var debouncedFilterAttList = debounce_(function() { filterAttListLocal(); }, 200);
var debouncedFilterAttRecord = debounce_(function() { filterAttRecordLocal(); }, 200);
var debouncedFilterScheduleList = debounce_(function() { filterScheduleListLocal(); }, 200);
var debouncedFilterLeaves = debounce_(function() { filterLeavesLocal(); }, 200);

// ============ 권한 헬퍼 ============
var ROLE_LEVELS = { '최고관리자': 5, '사업부장': 4, '총괄관리자': 3, '팀장': 2, '조직관리자': 2, '직원': 1 };

function isEmployeeRole() { return userRole === '직원'; }
function isOrgManager() { return userRole === '조직관리자'; }

function isManager() {
  return (ROLE_LEVELS[userRole] || 1) >= 2;
}

function isSuperAdmin() {
  return (ROLE_LEVELS[userRole] || 1) >= 3;
}

// 멀티 조직 지원 (쉼표 구분)
function getUserOrgList() {
  if (!userOrg) return [];
  return userOrg.split(',').map(function(o) { return o.trim(); });
}

// ============ 역할별 UI 제어 ============
function applyRoleBasedUI() {
  var navItems = document.querySelectorAll('.sidebar-nav .nav-item');

  if (isEmployeeRole()) {
    // 직원: 대시보드, 직원관리, 리포트, 설정 숨김
    for (var i = 0; i < navItems.length; i++) {
      var onclick = navItems[i].getAttribute('onclick') || '';
      if (onclick.indexOf("'dashboard'") > -1 ||
          onclick.indexOf("'employee'") > -1 ||
          onclick.indexOf("'report'") > -1 ||
          onclick.indexOf("'settings'") > -1) {
        navItems[i].style.display = 'none';
      }
    }
    // '분석' 섹션 타이틀 숨김
    var sectionTitles = document.querySelectorAll('.nav-section-title');
    for (var j = 0; j < sectionTitles.length; j++) {
      if (sectionTitles[j].textContent.trim() === '분석') {
        sectionTitles[j].style.display = 'none';
      }
    }
    // 휴가 탭: '승인 대기', '전체 내역' 숨김
    var leaveTabs = document.querySelectorAll('#leaveTabBar .tab-item');
    if (leaveTabs.length > 1) leaveTabs[1].style.display = 'none';
    if (leaveTabs.length > 2) leaveTabs[2].style.display = 'none';
    // 근무일정: 조직필터/추가 버튼 숨김
    document.getElementById('scheduleOrgFilter').style.display = 'none';
    var schedHeader = document.querySelector('#page-schedule .header-actions');
    if (schedHeader) schedHeader.style.display = 'none';
    // 출퇴근기록: 급여 합계 숨김
    var attSummaryBar = document.getElementById('attSummaryBar');
    if (attSummaryBar) attSummaryBar.style.display = 'none';
  }

  if (isOrgManager()) {
    // 조직관리자: 급여 메뉴 숨김
    for (var k = 0; k < navItems.length; k++) {
      var onclickStr = navItems[k].getAttribute('onclick') || '';
      if (onclickStr.indexOf("'payroll'") > -1) {
        navItems[k].style.display = 'none';
      }
    }
  }

  // 급여관리 탭: payroll admin만 표시
  if (!canPayrollAdmin) {
    var payrollTabs = document.querySelectorAll('#payrollTabBar .tab-item');
    if (payrollTabs.length > 1) {
      payrollTabs[1].style.display = 'none';
    }
  }

  // 마감 관리 탭: payroll admin만 표시
  if (canPayrollAdmin) {
    var closingTab = document.getElementById('payrollClosingTab');
    if (closingTab) closingTab.style.display = '';
  }

  // 스케줄 게시/미게시 버튼: 관리자만 표시
  if (isManager()) {
    var pubBtn = document.getElementById('schedPublishBtn');
    var unpubBtn = document.getElementById('schedUnpublishBtn');
    var copyBtn = document.getElementById('schedCopyBtn');
    if (pubBtn) pubBtn.style.display = '';
    if (unpubBtn) unpubBtn.style.display = '';
    if (copyBtn) copyBtn.style.display = '';
  }

  // 요청 관리 탭: 관리자만 표시
  if (isManager()) {
    var reqManageTab = document.getElementById('requestManageTab');
    if (reqManageTab) reqManageTab.style.display = '';
  }
}

// ============ 초기화 ============
document.addEventListener('DOMContentLoaded', function() {
  startClock();
  initSmartDateInputs_();

  if (window.innerWidth <= 768) {
    document.getElementById('mobileMenuBtn').style.display = 'flex';
  }

  // GitHub Pages: OAuth 인증 후 초기화
  if (typeof initGoogleAuth === 'function') {
    showLoading();
    initGoogleAuth().then(function(info) {
      // auth.js에서 userEmail, userName이 이미 설정됨
      // 역할/조직은 getInitialData에서 서버 조회
      updateUserUI_();
      loadInitialData();
    }).catch(function(err) {
      hideLoading();
      console.error('OAuth 인증 실패:', err);
      showToast('로그인이 필요합니다. @zsoo.kr 계정으로 로그인해주세요.', 'error');
    });
  } else {
    // GAS 내부 실행 (fallback)
    updateUserUI_();
    loadInitialData();
  }
});

function updateUserUI_() {
  var avatar = document.getElementById('userAvatar');
  var nameDisp = document.getElementById('userNameDisplay');
  var roleDisp = document.getElementById('userRoleDisplay');
  if (avatar) avatar.textContent = userName ? userName.charAt(0) : '?';
  if (nameDisp) nameDisp.textContent = userName || userEmail;
  if (roleDisp) roleDisp.textContent = userRole + (userOrg ? ' / ' + userOrg : '');
}

/**
 * 스마트 날짜 입력: 모든 type="date" 요소에 연속 숫자 입력 지원
 * "20260205" 입력 → 자동으로 "2026-02-05" 변환
 * "0305" 입력 → 올해 "2026-03-05" 변환
 */
function initSmartDateInputs_() {
  document.addEventListener('keydown', function(e) {
    var el = e.target;
    if (!el || el.type !== 'date') return;

    // 숫자키만 버퍼에 축적
    if (e.key >= '0' && e.key <= '9') {
      if (!el._numBuf) el._numBuf = '';
      if (!el._numTimer) el._numBuf = ''; // 첫 입력 시 초기화
      el._numBuf += e.key;

      // 타이머 리셋 (800ms 이내 연속 입력)
      clearTimeout(el._numTimer);
      el._numTimer = setTimeout(function() {
        applySmartDate_(el);
        el._numBuf = '';
        el._numTimer = null;
      }, 800);

      // 8자리 완성 시 즉시 적용 (20260205)
      if (el._numBuf.length >= 8) {
        clearTimeout(el._numTimer);
        applySmartDate_(el);
        el._numBuf = '';
        el._numTimer = null;
      }
    }
  });
}

function applySmartDate_(el) {
  var buf = el._numBuf;
  if (!buf) return;
  var year, month, day;

  if (buf.length === 8) {
    // 20260205
    year = buf.substring(0, 4);
    month = buf.substring(4, 6);
    day = buf.substring(6, 8);
  } else if (buf.length === 6) {
    // 260205 → 2026-02-05
    year = '20' + buf.substring(0, 2);
    month = buf.substring(2, 4);
    day = buf.substring(4, 6);
  } else if (buf.length === 4) {
    // 0305 → 올해-03-05
    year = String(new Date().getFullYear());
    month = buf.substring(0, 2);
    day = buf.substring(2, 4);
  } else {
    return;
  }

  var m = parseInt(month), d = parseInt(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return;

  var dateStr = year + '-' + month + '-' + day;
  el.value = dateStr;

  // change 이벤트 발생시켜 연결된 핸들러 동작
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function loadInitialData() {
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        // 서버에서 역할/조직 정보 설정 (GitHub Pages용)
        if (result.data.userRole) userRole = result.data.userRole;
        if (result.data.userOrg) userOrg = result.data.userOrg;
        updateUserUI_();

        allEmployees = result.data.employees || [];
        allTemplates = result.data.templates || [];
        todayAttendance = result.data.todayAttendance || [];
        myStatus = result.data.myStatus || null;
        organizations = result.data.organizations || [];
        leaveTypes = result.data.leaveTypes || [];
        attendanceStatusList = result.data.attendanceStatusList || [];
        pendingLeavesCount = result.data.pendingLeaves || 0;
        window._dashPendingLeaves = pendingLeavesCount;
        canPayrollAdmin = result.data.canPayrollAdmin || false;
        var pendingRequestsCount = result.data.pendingRequests || 0;
        window._dashPendingRequests = pendingRequestsCount;

        // 직원 데이터 (탭은 lazy load)

        populateOrgSelects();
        updateLeaveBadge();
        updateRequestBadge(pendingRequestsCount);
        applyRoleBasedUI();

        // 직원은 출퇴근 페이지가 기본, 관리자는 대시보드
        if (isEmployeeRole()) {
          navigateTo('clock');
        } else {
          renderDashboard();
        }

        updateClockStatus();
        if (!isEmployeeRole()) {
          applyEmployeeFilters();
        }

        // 관리자 전용 버튼 표시
        if (isManager()) {
          var manageBtn = document.getElementById('leaveManageBtn');
          if (manageBtn) manageBtn.style.display = '';
        }

        // 기본 날짜 설정
        var now = new Date();
        var ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        document.getElementById('myAttMonth').value = ym;
        var reportPeriodEl = document.getElementById('reportPeriod');
        if (reportPeriodEl) reportPeriodEl.value = ym;
      } else {
        showToast(result.message || '데이터 로드 실패', 'error');
      }
    })
    .withFailureHandler(function(err) {
      hideLoading();
      showToast('서버 오류: ' + err.message, 'error');
    })
    .getInitialData();
}

function refreshData() {
  loadInitialData();
  showToast('데이터를 새로고침했습니다.', 'info');
}

function populateOrgSelects() {
  var ids = ['empFilterOrg', 'scheduleOrgFilter', 'reportOrg', 'payrollCalcOrg'];
  for (var s = 0; s < ids.length; s++) {
    var sel = document.getElementById(ids[s]);
    if (!sel) continue;
    var firstOpt = sel.options[0] ? sel.options[0].outerHTML : '<option value="">전체 조직</option>';
    sel.innerHTML = firstOpt;
    for (var i = 0; i < organizations.length; i++) {
      sel.innerHTML += '<option value="' + organizations[i] + '">' + organizations[i] + '</option>';
    }
  }

  var empOrgSel = document.getElementById('empFormOrg');
  empOrgSel.innerHTML = '<option value="">선택</option>';
  for (var j = 0; j < organizations.length; j++) {
    empOrgSel.innerHTML += '<option value="' + organizations[j] + '">' + organizations[j] + '</option>';
  }
}

function updateLeaveBadge() {
  var badge = document.getElementById('leaveBadge');
  if (pendingLeavesCount > 0 && isManager()) {
    badge.textContent = pendingLeavesCount;
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }
  var pc = document.getElementById('pendingCount');
  if (pc && pendingLeavesCount > 0) {
    pc.textContent = '(' + pendingLeavesCount + ')';
  }
}

function updateRequestBadge(count) {
  var badge = document.getElementById('requestBadge');
  if (count > 0 && isManager()) {
    badge.textContent = count;
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }
}

// ============ SPA 네비게이션 ============
function navigateTo(page) {
  // 역할별 페이지 접근 가드
  if (isEmployeeRole()) {
    var allowedPages = ['clock', 'schedule', 'att-record', 'leave', 'leave-accrual', 'payroll', 'request', 'profile'];
    if (allowedPages.indexOf(page) === -1) return;
  }
  if (isOrgManager() && page === 'payroll') return;

  currentPage = page;

  var sections = document.querySelectorAll('.page-section');
  for (var i = 0; i < sections.length; i++) {
    sections[i].classList.remove('active');
  }
  var target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');

  var navItems = document.querySelectorAll('.nav-item');
  for (var j = 0; j < navItems.length; j++) {
    navItems[j].classList.remove('active');
    var onclick = navItems[j].getAttribute('onclick');
    if (onclick && onclick.indexOf("'" + page + "'") > -1) {
      navItems[j].classList.add('active');
    }
  }

  // 페이지별 로드
  if (page === 'dashboard') renderDashboard();
  if (page === 'clock') { updateClockStatus(); initClockAdmin(); }
  if (page === 'att-record') initAttRecordPage();
  if (page === 'schedule') loadSchedule();
  if (page === 'leave') loadLeaves();
  if (page === 'leave-accrual') initAccrualPage();
  if (page === 'payroll') loadPayroll();
  if (page === 'employee') applyEmployeeFilters();
  if (page === 'report') loadReport();
  if (page === 'request') loadRequests();
  if (page === 'settings') loadSettings();
  if (page === 'profile') loadProfile();

  document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ============ 대시보드 ============
function renderDashboard() {
  var active = allEmployees.filter(function(e) { return e.status === '재직'; });
  var total = active.length;
  var clockedIn = todayAttendance.length;
  var clockedOut = todayAttendance.filter(function(r) { return r.clockOut; }).length;
  var lateCount = todayAttendance.filter(function(r) { return r.status === '지각'; }).length;
  var leaveCount = todayAttendance.filter(function(r) { return r.status === '휴가' || r.status === '반차'; }).length;

  // 날짜 제목
  var now = new Date();
  var dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  document.getElementById('dashDateTitle').textContent =
    now.getFullYear() + '년 ' + (now.getMonth() + 1) + '월 ' + now.getDate() + '일 (' + dayNames[now.getDay()] + ')';

  // 오늘의 근무 현황 (시프티 스타일 숫자)
  document.getElementById('dashStatIn').textContent = clockedIn;
  document.getElementById('dashStatLate').textContent = lateCount;
  document.getElementById('dashStatAbsent').textContent = Math.max(0, total - clockedIn - leaveCount);
  document.getElementById('dashStatOut').textContent = clockedOut;
  document.getElementById('dashStatLeave').textContent = leaveCount;
  document.getElementById('dashStatTotal').textContent = total;

  // 조직 필터 옵션 채우기
  var orgSelects = ['dashReportOrg', 'dashLeaveOrg'];
  for (var s = 0; s < orgSelects.length; s++) {
    var sel = document.getElementById(orgSelects[s]);
    if (sel && sel.options.length <= 1) {
      for (var o = 0; o < organizations.length; o++) {
        sel.add(new Option(organizations[o], organizations[o]));
      }
    }
  }

  // 조직별 출근율 바
  var orgHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">';
  for (var o = 0; o < organizations.length; o++) {
    var orgName = organizations[o];
    var orgTotal = active.filter(function(e) { return e.org === orgName; }).length;
    var orgPresent = todayAttendance.filter(function(r) { return r.org === orgName; }).length;
    var pct = orgTotal > 0 ? Math.round(orgPresent / orgTotal * 100) : 0;
    var barColor = pct >= 80 ? 'var(--success)' : (pct >= 50 ? 'var(--warning)' : 'var(--danger)');
    orgHtml += '<div style="background:var(--gray-50);border-radius:var(--radius-sm);padding:10px 12px;">' +
      '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:6px;">' +
      '<span>' + orgName + '</span><span style="color:' + barColor + ';">' + pct + '%</span></div>' +
      '<div style="background:var(--gray-200);border-radius:4px;height:8px;"><div style="background:' + barColor + ';height:100%;border-radius:4px;width:' + pct + '%;transition:width 0.5s;"></div></div>' +
      '<div style="font-size:11px;color:var(--gray-500);margin-top:4px;">' + orgPresent + '/' + orgTotal + '명 출근</div></div>';
  }
  orgHtml += '</div>';
  document.getElementById('dashOrgChart').innerHTML = orgHtml;

  // 관리자 작업 배지
  var tasksHtml = '<div style="display:flex;flex-direction:column;gap:10px;">';
  var pendingLeaves = window._dashPendingLeaves || 0;
  var pendingRequests = window._dashPendingRequests || 0;
  tasksHtml += taskItem_('fas fa-hourglass-half', '승인 대기 휴가', pendingLeaves, 'var(--warning)', "navigateTo('leave')");
  tasksHtml += taskItem_('fas fa-inbox', '처리 대기 요청', pendingRequests, 'var(--info)', "navigateTo('request')");
  tasksHtml += taskItem_('fas fa-user-clock', '미출근 직원', Math.max(0, total - clockedIn - leaveCount), 'var(--danger)', "navigateTo('att-record')");
  tasksHtml += taskItem_('fas fa-calendar-check', '미게시 스케줄', '-', 'var(--gray-500)', "navigateTo('schedule')");
  tasksHtml += '</div>';
  document.getElementById('dashAdminTasks').innerHTML = tasksHtml;

  // 기간별 통계 자동 로드 (이번 달)
  if (!document.getElementById('dashPeriodStart').value) {
    setDashPeriod('month');
  } else {
    loadDashboardPeriodStats();
  }

  // 오늘 출퇴근 현황 lazy load (관리자만)
  if (!isEmployeeRole()) {
    google.script.run.withSuccessHandler(function(result) {
      if (!result.success) return;
      todayAttendance = result.data;
      // 오늘 현황 숫자 업데이트
      var clockedIn = todayAttendance.length;
      var clockedOut = todayAttendance.filter(function(r) { return r.clockOut; }).length;
      var lateCount = todayAttendance.filter(function(r) { return r.status === '지각'; }).length;
      var leaveCount = todayAttendance.filter(function(r) { return r.status === '휴가' || r.status === '반차'; }).length;
      document.getElementById('dashStatIn').textContent = clockedIn;
      document.getElementById('dashStatLate').textContent = lateCount;
      document.getElementById('dashStatOut').textContent = clockedOut;
      document.getElementById('dashStatLeave').textContent = leaveCount;
      document.getElementById('dashStatAbsent').textContent = Math.max(0, total - clockedIn - leaveCount);
      // 조직별 출근율 재렌더
      var orgHtml2 = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">';
      for (var o2 = 0; o2 < organizations.length; o2++) {
        var on2 = organizations[o2];
        var ot2 = active.filter(function(e) { return e.org === on2; }).length;
        var op2 = todayAttendance.filter(function(r) { return r.org === on2; }).length;
        var pc2 = ot2 > 0 ? Math.round(op2 / ot2 * 100) : 0;
        var bc2 = pc2 >= 80 ? 'var(--success)' : (pc2 >= 50 ? 'var(--warning)' : 'var(--danger)');
        orgHtml2 += '<div style="background:var(--gray-50);border-radius:var(--radius-sm);padding:10px 12px;">' +
          '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:6px;">' +
          '<span>' + on2 + '</span><span style="color:' + bc2 + ';">' + pc2 + '%</span></div>' +
          '<div style="background:var(--gray-200);border-radius:4px;height:8px;"><div style="background:' + bc2 + ';height:100%;border-radius:4px;width:' + pc2 + '%;"></div></div>' +
          '<div style="font-size:11px;color:var(--gray-500);margin-top:4px;">' + op2 + '/' + ot2 + '명</div></div>';
      }
      orgHtml2 += '</div>';
      document.getElementById('dashOrgChart').innerHTML = orgHtml2;
    }).withFailureHandler(function(){}).getTodayAttendance();

    // 대기건수 lazy load
    google.script.run.withSuccessHandler(function(r) {
      if (r.success) {
        pendingLeavesCount = r.data;
        window._dashPendingLeaves = r.data;
        document.getElementById('dashAdminTasks').querySelectorAll('strong')[0].textContent = r.data;
      }
    }).withFailureHandler(function(){}).getPendingLeaveCount();

    loadHeadcountChart();
    loadRenewalAlerts();
    loadCapacityAnalysis();
  }
}

function taskItem_(icon, label, count, color, onclick) {
  var badge = count === '-' ? '<span style="color:var(--gray-400);font-size:12px;">조회</span>' :
    '<span style="background:' + color + ';color:white;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700;">' + count + '</span>';
  return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--gray-50);border-radius:var(--radius-sm);cursor:pointer;" onclick="' + onclick + '">' +
    '<div style="display:flex;align-items:center;gap:10px;"><i class="' + icon + '" style="color:' + color + ';width:18px;text-align:center;"></i>' +
    '<span style="font-size:13px;">' + label + '</span></div>' + badge + '</div>';
}

var _headcountData = null;
var _headcountChart = null;
var _headcountMode = 'type';
var _renewalAlertsCache = null;
var _capacityCache = null;

function loadHeadcountChart() {
  if (_headcountData) {
    renderHeadcountChart_(_headcountData);
    return;
  }
  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        _headcountData = result.data;
        document.getElementById('dashHeadcountCard').style.display = '';
        renderHeadcountChart_(_headcountData);
      }
    })
    .withFailureHandler(function() {})
    .getMonthlyHeadcount();
}

function switchHeadcountChart(mode) {
  _headcountMode = mode;
  document.getElementById('hcChartTypeBtn').style.fontWeight = mode === 'type' ? '700' : '400';
  document.getElementById('hcChartTeamBtn').style.fontWeight = mode === 'team' ? '700' : '400';
  if (_headcountData) renderHeadcountChart_(_headcountData);
}

function renderHeadcountChart_(data) {
  if (_headcountChart) { _headcountChart.destroy(); _headcountChart = null; }
  var canvas = document.getElementById('headcountChart');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');

  if (_headcountMode === 'type') {
    var items = data.byType || [];
    if (items.length === 0) return;
    var labels = items.map(function(d) { return d.date.substring(0, 7); });
    _headcountChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: '정규직', data: items.map(function(d) { return d.regular; }), backgroundColor: '#1565C0', stack: 'a' },
          { label: '1년 계약직', data: items.map(function(d) { return d.yearly; }), backgroundColor: '#42A5F5', stack: 'a' },
          { label: '3개월 계약직', data: items.map(function(d) { return d.quarterly; }), backgroundColor: '#A5D2F0', stack: 'a' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { stacked: true, ticks: { font: { size: 10 } } },
          y: { stacked: true, beginAtZero: true, title: { display: true, text: '인원(명)', font: { size: 11 } } }
        }
      }
    });
  } else {
    var items = data.byTeam || [];
    if (items.length === 0) return;
    var labels = items.map(function(d) { return d.date.substring(0, 7); });
    var teams = ['검토팀', '분류팀', '뉴터칭콜팀', '작성팀', '세무서대응팀', '인용확인팀', '신고팀', '고객지원팀'];
    var colors = ['#1565C0', '#42A5F5', '#F59E0B', '#10B981', '#8B5CF6', '#EC4899', '#EF4444', '#6B7280'];
    var datasets = [];
    for (var t = 0; t < teams.length; t++) {
      var teamName = teams[t];
      datasets.push({
        label: teamName,
        data: items.map(function(d) { return d[teamName] || 0; }),
        borderColor: colors[t],
        backgroundColor: colors[t] + '22',
        fill: false,
        tension: 0.3,
        pointRadius: 3
      });
    }
    _headcountChart = new Chart(ctx, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } } },
        scales: {
          x: { ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, title: { display: true, text: '인원(명)', font: { size: 11 } } }
        }
      }
    });
  }
}

function renderRenewalAlertsUI_(data) {
  var el = document.getElementById('dashRenewalAlerts');
  if (!el) return;
  document.getElementById('dashHRCardsRow').style.display = '';
  if (!data || data.length === 0) {
    el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-400);font-size:13px;"><i class="fas fa-check-circle"></i> 알림 대상 없음</div>';
    return;
  }
  var html = '<div class="table-wrapper"><table style="font-size:12px;"><thead><tr><th>이름</th><th>팀</th><th>검토일</th><th>D-day</th><th>확정</th></tr></thead><tbody>';
  for (var i = 0; i < data.length; i++) {
    var a = data[i];
    var ddayText = a.dday <= 0 ? 'D+' + Math.abs(a.dday) : 'D-' + a.dday;
    var levelColor = a.level === 'overdue' ? 'var(--danger)' : a.level === 'urgent' ? '#dc2626' : a.level === 'warning' ? 'var(--warning)' : 'var(--gray-600)';
    var confirmBadge = a.confirmed
      ? '<span style="color:var(--success);font-size:11px;"><i class="fas fa-check-circle"></i> ' + a.confirmDate + '</span>'
      : '<span style="color:var(--gray-400);font-size:11px;">미확정</span>';
    html += '<tr><td><strong>' + a.name + '</strong></td><td>' + a.team + '</td>' +
      '<td>' + a.reviewDate + '</td>' +
      '<td><span style="color:' + levelColor + ';font-weight:700;">' + ddayText + '</span></td>' +
      '<td>' + confirmBadge + '</td></tr>';
  }
  html += '</tbody></table></div>';
  el.innerHTML = html;
}

function loadRenewalAlerts() {
  if (_renewalAlertsCache !== null) {
    renderRenewalAlertsUI_(_renewalAlertsCache);
    return;
  }
  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success && result.data) {
        _renewalAlertsCache = result.data;
      } else {
        _renewalAlertsCache = [];
      }
      renderRenewalAlertsUI_(_renewalAlertsCache);
    })
    .withFailureHandler(function() {
      var el = document.getElementById('dashRenewalAlerts');
      if (el) el.innerHTML = '<p style="color:var(--gray-400);font-size:12px;">조회 실패</p>';
    })
    .getRenewalAlerts();
}

function renderCapacityUI_(data) {
  var el = document.getElementById('dashCapacity');
  if (!el) return;
  document.getElementById('dashHRCardsRow').style.display = '';
  if (!data || data.length === 0) {
    el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-400);font-size:13px;">케파 데이터 없음</div>';
    return;
  }
  var html = '<div class="table-wrapper"><table style="font-size:12px;"><thead><tr><th>팀</th><th>인원</th><th>현재</th><th>숙련후</th><th>성장률</th></tr></thead><tbody>';
  var totalMembers = 0, totalCur = 0, totalTrained = 0;
  for (var i = 0; i < data.length; i++) {
    var t = data[i];
    totalMembers += t.memberCount;
    totalCur += t.totalCurrent;
    totalTrained += t.totalTrained;
    var growthColor = t.growth > 0 ? 'var(--success)' : 'var(--gray-500)';
    html += '<tr><td><strong>' + t.team + '</strong></td>' +
      '<td style="text-align:center;">' + t.memberCount + '</td>' +
      '<td style="text-align:right;">' + t.totalCurrent.toLocaleString() + '</td>' +
      '<td style="text-align:right;">' + t.totalTrained.toLocaleString() + '</td>' +
      '<td style="text-align:center;color:' + growthColor + ';font-weight:600;">' + (t.growth > 0 ? '+' : '') + t.growth + '%</td></tr>';
  }
  var totalGrowth = totalCur > 0 ? Math.round((totalTrained - totalCur) / totalCur * 100) : 0;
  html += '<tr style="font-weight:700;border-top:2px solid var(--gray-300);"><td>합계</td>' +
    '<td style="text-align:center;">' + totalMembers + '</td>' +
    '<td style="text-align:right;">' + totalCur.toLocaleString() + '</td>' +
    '<td style="text-align:right;">' + totalTrained.toLocaleString() + '</td>' +
    '<td style="text-align:center;color:var(--success);">+' + totalGrowth + '%</td></tr>';
  html += '</tbody></table></div>';
  html += '<p style="font-size:11px;color:var(--gray-400);margin-top:8px;">KPI: 일일 처리 건수 기준</p>';
  el.innerHTML = html;
}

function loadCapacityAnalysis() {
  if (_capacityCache !== null) {
    renderCapacityUI_(_capacityCache);
    return;
  }
  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success && result.data) {
        _capacityCache = result.data;
      } else {
        _capacityCache = [];
      }
      renderCapacityUI_(_capacityCache);
    })
    .withFailureHandler(function() {
      var el = document.getElementById('dashCapacity');
      if (el) el.innerHTML = '<p style="color:var(--gray-400);font-size:12px;">조회 실패</p>';
    })
    .getCapacityAnalysis();
}

function setDashPeriod(type) {
  var now = new Date();
  var y = now.getFullYear();
  var m = now.getMonth();
  var d = now.getDate();
  var startEl = document.getElementById('dashPeriodStart');
  var endEl = document.getElementById('dashPeriodEnd');

  if (type === 'week') {
    var dayOfWeek = now.getDay();
    var monday = new Date(now);
    monday.setDate(d - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    startEl.value = monday.getFullYear() + '-' + String(monday.getMonth() + 1).padStart(2, '0') + '-' + String(monday.getDate()).padStart(2, '0');
    endEl.value = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  } else {
    startEl.value = y + '-' + String(m + 1).padStart(2, '0') + '-01';
    endEl.value = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  loadDashboardPeriodStats();
}

function loadDashboardPeriodStats() {
  var startDate = document.getElementById('dashPeriodStart').value;
  var endDate = document.getElementById('dashPeriodEnd').value;
  if (!startDate || !endDate) return;

  document.getElementById('dashCumulativeStats').innerHTML = '<div style="text-align:center;padding:12px;color:var(--gray-400);"><i class="fas fa-spinner fa-spin"></i></div>';

  google.script.run.withSuccessHandler(function(result) {
    if (!result.success) {
      document.getElementById('dashCumulativeStats').innerHTML = '<div style="color:var(--danger);font-size:12px;">' + result.message + '</div>';
      return;
    }
    var data = result.data;
    var s = data.summary;

    // 출퇴근 누적 카드 (시프티 스타일)
    var cumHtml = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center;">';
    cumHtml += cumItem_('지각', s.totalLate, '건', 'var(--danger)');
    cumHtml += cumItem_('결근', s.totalAbsent, '건', 'var(--warning)');
    cumHtml += cumItem_('출근율', s.attendanceRate, '%', s.attendanceRate >= 80 ? 'var(--success)' : 'var(--danger)');
    cumHtml += cumItem_('근무일', data.period.workDays, '일', 'var(--gray-700)');
    cumHtml += cumItem_('총 근무', s.totalHours, 'h', 'var(--info)');
    cumHtml += cumItem_('총 급여', (s.totalPay / 10000).toFixed(0), '만원', 'var(--primary)');
    cumHtml += '</div>';
    document.getElementById('dashCumulativeStats').innerHTML = cumHtml;

    // 리포트 테이블 (시프티 리포트 현황)
    var orgFilter = document.getElementById('dashReportOrg').value;
    var empStats = data.empStats;
    if (orgFilter) empStats = empStats.filter(function(e) { return e.org === orgFilter; });

    var reportHtml = '<div class="table-wrapper"><table><thead><tr>' +
      '<th>이름</th><th>조직</th><th>출근일</th><th>지각</th><th>출근율</th><th>근무시간</th><th>급여</th>' +
      '</tr></thead><tbody>';
    if (empStats.length === 0) {
      reportHtml += '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--gray-400);">데이터 없음</td></tr>';
    }
    for (var j = 0; j < empStats.length; j++) {
      var es = empStats[j];
      var rateColor = es.attendanceRate >= 80 ? 'var(--success)' : (es.attendanceRate >= 50 ? 'var(--warning)' : 'var(--danger)');
      reportHtml += '<tr><td><strong>' + es.name + '</strong></td><td>' + es.org + '</td>' +
        '<td>' + es.present + '일</td>' +
        '<td style="color:' + (es.late > 0 ? 'var(--danger)' : '') + ';font-weight:' + (es.late > 0 ? '700' : '400') + ';">' + es.late + '</td>' +
        '<td style="color:' + rateColor + ';font-weight:700;">' + es.attendanceRate + '%</td>' +
        '<td>' + es.hours + 'h</td><td style="text-align:right;">' + formatCurrency_(es.pay) + '</td></tr>';
    }
    reportHtml += '</tbody></table></div>';
    document.getElementById('dashReportTable').innerHTML = reportHtml;

    // 대시보드 누적 데이터 캐시 (휴가 현황용)
    window._dashPeriodData = data;
    renderDashLeaves_();

  }).withFailureHandler(function(e) {
    document.getElementById('dashCumulativeStats').innerHTML = '<div style="color:var(--danger);font-size:12px;">조회 실패</div>';
  }).getDashboardStats(startDate, endDate);
}

function cumItem_(label, value, unit, color) {
  return '<div style="padding:6px 4px;">' +
    '<div style="font-size:20px;font-weight:800;color:' + color + ';">' + value + '<span style="font-size:12px;font-weight:400;">' + unit + '</span></div>' +
    '<div style="font-size:11px;color:var(--gray-500);">' + label + '</div></div>';
}

function renderDashLeaves_() {
  var container = document.getElementById('dashLeaveStatus');
  var orgFilter = document.getElementById('dashLeaveOrg').value;

  // 간단한 휴가 요약 (pendingLeaves + 최근 휴가)
  var html = '<div style="text-align:center;padding:20px;color:var(--gray-400);">';
  var pendingLeaves = window._dashPendingLeaves || 0;
  if (pendingLeaves > 0) {
    html = '<div style="padding:12px;background:var(--warning-light);border-radius:var(--radius-sm);margin-bottom:12px;font-size:13px;">' +
      '<i class="fas fa-exclamation-triangle" style="color:var(--warning);margin-right:6px;"></i>' +
      '<strong>' + pendingLeaves + '건</strong>의 휴가 승인 대기 중' +
      ' <a href="javascript:navigateTo(\'leave\')" style="margin-left:8px;">바로가기</a></div>';
  } else {
    html = '<div style="padding:12px;background:var(--success-light);border-radius:var(--radius-sm);margin-bottom:12px;font-size:13px;">' +
      '<i class="fas fa-check-circle" style="color:var(--success);margin-right:6px;"></i>대기 중인 휴가 없음</div>';
  }

  // 오늘 휴가자 목록
  var todayLeaves = todayAttendance.filter(function(r) { return r.status === '휴가' || r.status === '반차'; });
  if (orgFilter) todayLeaves = todayLeaves.filter(function(r) { return r.org === orgFilter; });
  if (todayLeaves.length > 0) {
    html += '<div style="font-size:12px;font-weight:600;color:var(--gray-600);margin-bottom:6px;">오늘 휴가자 (' + todayLeaves.length + '명)</div>';
    for (var i = 0; i < todayLeaves.length; i++) {
      html += '<div style="padding:4px 0;font-size:13px;border-bottom:1px solid var(--gray-100);">' +
        '<strong>' + todayLeaves[i].employeeName + '</strong> <span style="color:var(--gray-500);">' + todayLeaves[i].org + '</span></div>';
    }
  } else {
    html += '<div style="font-size:13px;color:var(--gray-400);text-align:center;padding:16px;"><i class="fas fa-umbrella-beach" style="margin-right:4px;"></i>오늘 휴가자 없음</div>';
  }

  container.innerHTML = html;
}

function formatCurrency_(n) {
  if (!n) return '₩0';
  return '₩' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ============ 출퇴근 시계 ============
function startClock() {
  updateClockDisplay();
  setInterval(updateClockDisplay, 1000);
}

function updateClockDisplay() {
  var now = new Date();
  var h = String(now.getHours()).padStart(2, '0');
  var m = String(now.getMinutes()).padStart(2, '0');
  var s = String(now.getSeconds()).padStart(2, '0');
  document.getElementById('clockTime').textContent = h + ':' + m + ':' + s;

  var days = ['일', '월', '화', '수', '목', '금', '토'];
  var dateStr = now.getFullYear() + '년 ' + (now.getMonth() + 1) + '월 ' + now.getDate() + '일 (' + days[now.getDay()] + ')';
  document.getElementById('clockDate').textContent = dateStr;
}

function updateClockStatus() {
  var statusEl = document.getElementById('clockStatus');
  var btnIn = document.getElementById('btnClockIn');
  var btnOut = document.getElementById('btnClockOut');
  var btnGoOut = document.getElementById('btnGoOut');
  var btnReturn = document.getElementById('btnReturn');
  var outReturnBtns = document.getElementById('outReturnBtns');

  if (outReturnBtns) outReturnBtns.style.display = 'none';
  if (btnGoOut) btnGoOut.disabled = true;
  if (btnReturn) btnReturn.disabled = true;

  if (!myStatus || !myStatus.employeeId) {
    statusEl.innerHTML = '<i class="fas fa-exclamation-circle" style="font-size:10px;color:#FFD600;"></i> <span>직원 미등록</span>';
    btnIn.disabled = true;
    btnOut.disabled = true;
    return;
  }

  // 출퇴근 상태가 아직 로드 안 됐으면 서버에서 가져오기 (lazy)
  if (myStatus.clockedIn === undefined) {
    statusEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:10px;"></i> <span>상태 확인중...</span>';
    btnIn.disabled = true;
    btnOut.disabled = true;
    google.script.run.withSuccessHandler(function(result) {
      if (result.success && result.data) {
        myStatus = result.data;
      }
      updateClockStatusUI_();
    }).withFailureHandler(function() {
      statusEl.innerHTML = '<span>상태 조회 실패</span>';
      btnIn.disabled = false;
    }).getMyTodayStatus();
    return;
  }
  updateClockStatusUI_();
}

function updateClockStatusUI_() {
  var statusEl = document.getElementById('clockStatus');
  var btnIn = document.getElementById('btnClockIn');
  var btnOut = document.getElementById('btnClockOut');
  var btnGoOut = document.getElementById('btnGoOut');
  var btnReturn = document.getElementById('btnReturn');
  var outReturnBtns = document.getElementById('outReturnBtns');

  if (outReturnBtns) outReturnBtns.style.display = 'none';
  if (btnGoOut) btnGoOut.disabled = true;
  if (btnReturn) btnReturn.disabled = true;

  if (myStatus.clockedOut) {
    statusEl.innerHTML = '<i class="fas fa-check-circle" style="font-size:10px;color:#66BB6A;"></i> <span>퇴근 완료 (' + myStatus.clockOutTime + ') | 실근무: ' + (myStatus.netHours || 0) + 'h</span>';
    btnIn.disabled = true;
    btnOut.disabled = true;
  } else if (myStatus.clockedIn) {
    var statusText = '근무중 (출근: ' + myStatus.clockInTime + ')';
    var statusIcon = '<i class="fas fa-circle" style="font-size:10px;color:#66BB6A;"></i>';

    // 외출/복귀 상태 표시
    if (outReturnBtns) outReturnBtns.style.display = 'flex';
    if (myStatus.outTime && !myStatus.returnTime) {
      statusText = '외출중 (외출: ' + myStatus.outTime + ')';
      statusIcon = '<i class="fas fa-walking" style="font-size:10px;color:#FF9800;"></i>';
      if (btnGoOut) btnGoOut.disabled = true;
      if (btnReturn) btnReturn.disabled = false;
      btnOut.disabled = true; // 외출중에는 퇴근 불가
    } else if (myStatus.outTime && myStatus.returnTime) {
      statusText = '근무중 (출근: ' + myStatus.clockInTime + ' | 외출: ' + myStatus.outTime + '~' + myStatus.returnTime + ')';
      if (btnGoOut) btnGoOut.disabled = true; // 이미 사용
      if (btnReturn) btnReturn.disabled = true;
    } else {
      if (btnGoOut) btnGoOut.disabled = false;
      if (btnReturn) btnReturn.disabled = true;
    }

    statusEl.innerHTML = statusIcon + ' <span>' + statusText + '</span>';
    btnIn.disabled = true;
    if (!myStatus.outTime || myStatus.returnTime) btnOut.disabled = false;
  } else {
    statusEl.innerHTML = '<i class="fas fa-circle" style="font-size:10px;color:var(--gray-400);"></i> <span>미출근</span>';
    btnIn.disabled = false;
    btnOut.disabled = true;
  }
}

// ============ 커스텀 확인 모달 ============
function showConfirm(msg, icon, onConfirm) {
  var overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  var iconHtml = icon === 'in' ? '<i class="fas fa-sign-in-alt" style="color:var(--primary);"></i>' :
    icon === 'out' ? '<i class="fas fa-sign-out-alt" style="color:var(--danger);"></i>' :
    '<i class="fas fa-question-circle" style="color:var(--primary);"></i>';
  overlay.innerHTML = '<div class="confirm-box">' +
    '<div class="confirm-icon">' + iconHtml + '</div>' +
    '<div class="confirm-msg">' + msg + '</div>' +
    '<div class="confirm-btns">' +
    '<button class="btn btn-outline" id="confirmNo">취소</button>' +
    '<button class="btn btn-primary" id="confirmYes">확인</button>' +
    '</div></div>';
  document.body.appendChild(overlay);
  overlay.querySelector('#confirmNo').onclick = function() { document.body.removeChild(overlay); };
  overlay.querySelector('#confirmYes').onclick = function() { document.body.removeChild(overlay); onConfirm(); };
  overlay.addEventListener('click', function(e) { if (e.target === overlay) document.body.removeChild(overlay); });
}

// ============ 출퇴근 3탭 전환 (시프티 스타일) ============
var _clockTabLoaded = {};
function switchClockTab(tab) {
  ['schedule', 'record', 'request'].forEach(function(t) {
    document.getElementById('clockTab' + t.charAt(0).toUpperCase() + t.slice(1)).classList.toggle('active', t === tab);
    document.getElementById('clockPanel' + t.charAt(0).toUpperCase() + t.slice(1)).style.display = t === tab ? '' : 'none';
  });
  // 즉시 렌더 (서버 호출 없음)
  if (tab === 'schedule' && !_clockTabLoaded.schedule) {
    renderMyWorkStats_();
    renderMyLeaveStats_();
    loadMyScheduleTab();
    _clockTabLoaded.schedule = true;
  }
  // lazy load (비차단 스피너)
  if (tab === 'record' && !_clockTabLoaded.record) {
    loadMyAttendance();
    _clockTabLoaded.record = true;
  }
  if (tab === 'request' && !_clockTabLoaded.request) { loadMyRequests_(); _clockTabLoaded.request = true; }
}

var _mySchedMonthOffset = 0;
function changeMySchedMonth(dir) {
  if (dir === 0) _mySchedMonthOffset = 0;
  else _mySchedMonthOffset += dir;
  loadMyScheduleTab();
}

function loadMyScheduleTab() {
  var now = new Date();
  now.setMonth(now.getMonth() + _mySchedMonthOffset);
  var year = now.getFullYear(), month = now.getMonth() + 1;
  document.getElementById('clockSchedTitle').textContent = year + '년 ' + month + '월';

  // 빈 달력 즉시 표시, 데이터 백그라운드 로드
  renderMyScheduleCalendar_([], year, month);
  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success && result.data) renderMyScheduleCalendar_(result.data, year, month);
    })
    .withFailureHandler(function() {})
    .getMySchedule({ year: year, month: month });
}

function renderMyScheduleCalendar_(events, year, month) {
  var firstDay = new Date(year, month - 1, 1).getDay();
  var lastDate = new Date(year, month, 0).getDate();
  var today = new Date();
  var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

  // 이벤트 맵
  var eventMap = {};
  if (events) {
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (!eventMap[ev.date]) eventMap[ev.date] = [];
      eventMap[ev.date].push(ev);
    }
  }

  var html = '<div class="calendar-grid">';
  var dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  for (var h = 0; h < 7; h++) {
    var cls = h === 0 ? ' style="color:var(--danger);"' : (h === 6 ? ' style="color:var(--primary);"' : '');
    html += '<div class="calendar-day-header"' + cls + '>' + dayNames[h] + '</div>';
  }

  // 빈 셀
  for (var b = 0; b < firstDay; b++) html += '<div class="calendar-cell" style="background:var(--gray-50);"></div>';

  for (var d = 1; d <= lastDate; d++) {
    var dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    var isToday = dateStr === todayStr;
    var isHol = KOREAN_HOLIDAYS_JS[dateStr];
    var dow = new Date(year, month - 1, d).getDay();
    var cellCls = 'calendar-cell' + (isToday ? ' today' : '') + (dow === 0 ? ' sunday' : '') + (dow === 6 ? ' saturday' : '');

    html += '<div class="' + cellCls + '">';
    var numStyle = isHol || dow === 0 ? 'color:var(--danger);' : (dow === 6 ? 'color:var(--primary);' : '');
    html += '<div class="day-num" style="' + numStyle + 'font-weight:' + (isToday ? '800' : '500') + ';">' + d;
    if (isHol) html += ' <span style="font-size:9px;">공휴일</span>';
    html += '</div>';

    var dayEvents = eventMap[dateStr] || [];
    for (var e = 0; e < Math.min(dayEvents.length, 3); e++) {
      var ev = dayEvents[e];
      if (ev.type === 'schedule') {
        html += '<div class="calendar-event schedule" style="font-size:10px;">' + ev.startTime + '-' + ev.endTime + '</div>';
      } else if (ev.type === 'leave') {
        html += '<div class="calendar-event leave" style="font-size:10px;">' + ev.leaveType + '</div>';
      }
    }
    if (dayEvents.length > 3) html += '<div style="font-size:9px;color:var(--gray-500);">+' + (dayEvents.length - 3) + '개</div>';
    html += '</div>';
  }
  html += '</div>';
  document.getElementById('clockMyScheduleGrid').innerHTML = html;
}

/** 출퇴근 후 탭 캐시 리셋 + 즉시 갱신 */
function refreshClockTabs_() {
  _clockTabLoaded = {};  // 탭 캐시 전부 리셋
  renderMyWorkStats_();  // 내 근로 통계 즉시 갱신
}

function renderMyWorkStats_() {
  var container = document.getElementById('clockMyWorkStats');
  var s = myStatus || {};
  var netH = s.netHours || 0;
  var items = [
    { label: '오늘 출근', value: s.clockInTime || '-', color: s.clockedIn ? 'var(--success)' : 'var(--gray-400)' },
    { label: '오늘 퇴근', value: s.clockOutTime || '-', color: s.clockedOut ? 'var(--primary)' : 'var(--gray-400)' },
    { label: '오늘 근무시간', value: netH > 0 ? netH + 'h' : '-', color: 'var(--gray-700)' },
    { label: '상태', value: s.status || '미출근', color: s.status === '지각' ? 'var(--danger)' : 'var(--success)' }
  ];
  var html = '';
  for (var i = 0; i < items.length; i++) {
    html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--gray-100);">' +
      '<span style="color:var(--gray-600);font-size:12px;">' + items[i].label + '</span>' +
      '<strong style="color:' + items[i].color + ';">' + items[i].value + '</strong></div>';
  }
  container.innerHTML = html;
}

function renderMyLeaveStats_() {
  var container = document.getElementById('clockMyLeaveStats');
  var emp = allEmployees && allEmployees.length > 0 ? allEmployees[0] : null;
  var remain = emp ? (emp.annualLeave || 0) : 0;
  container.innerHTML =
    '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--gray-100);">' +
    '<span style="color:var(--gray-600);font-size:12px;">연차 잔여</span><strong style="color:var(--primary);">' + remain + '일</strong></div>' +
    '<div style="text-align:center;padding:16px;color:var(--gray-400);font-size:11px;">상세 내역은 휴가 메뉴에서 확인</div>';
}

function loadMyRequests_() {
  // 내 요청 데이터 로드
  var startEl = document.getElementById('myReqStart');
  var endEl = document.getElementById('myReqEnd');
  if (!startEl.value) {
    var d = new Date();
    d.setDate(d.getDate() - 14);
    startEl.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var now = new Date();
    endEl.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }
  // TODO: 서버에서 내 요청 목록 로드
  document.getElementById('myReqPending').textContent = '0';
  document.getElementById('myReqDone').textContent = '0';
}

function handleClockIn() {
  showConfirm('출근 하시겠습니까?', 'in', function() {
  document.getElementById('btnClockIn').disabled = true;
  // showLoading 제거 — 버튼 disable만으로 피드백

  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        myStatus = {
          employeeId: result.record.employeeId,
          employeeName: result.record.employeeName,
          clockedIn: true,
          clockedOut: false,
          clockInTime: result.record.clockIn,
          clockOutTime: null,
          status: result.record.status,
          netHours: 0
        };
        todayAttendance.push(result.record);
        updateClockStatus();
        refreshClockTabs_();
        showToast(result.message, 'success');
      } else {
        showToast(result.message, 'error');
        document.getElementById('btnClockIn').disabled = false;
      }
    })
    .withFailureHandler(function(err) {
      showToast('서버 오류: ' + err.message, 'error');
      document.getElementById('btnClockIn').disabled = false;
    })
    .clockIn('');
  });
}

function handleClockOut() {
  showConfirm('퇴근 하시겠습니까?', 'out', function() {
  document.getElementById('btnClockOut').disabled = true;

  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        myStatus.clockedOut = true;
        myStatus.clockOutTime = result.record.clockOut;
        myStatus.netHours = result.record.netHours;
        // 로컬 업데이트
        for (var i = 0; i < todayAttendance.length; i++) {
          if (todayAttendance[i].id === result.record.id) {
            todayAttendance[i] = result.record;
            break;
          }
        }
        updateClockStatus();
        refreshClockTabs_();
        showToast(result.message, 'success');
      } else {
        showToast(result.message, 'error');
        document.getElementById('btnClockOut').disabled = false;
      }
    })
    .withFailureHandler(function(err) {
      showToast('서버 오류: ' + err.message, 'error');
      document.getElementById('btnClockOut').disabled = false;
    })
    .clockOut('');
  });
}

// ============ 외출/복귀 ============
function handleOutReturn(type) {
  var label = type === 'out' ? '외출' : '복귀';
  showConfirm(label + ' 하시겠습니까?', type === 'out' ? 'out' : 'in', function() {

  var btnId = type === 'out' ? 'btnGoOut' : 'btnReturn';
  document.getElementById(btnId).disabled = true;

  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        if (type === 'out') {
          myStatus.outTime = result.record.outTime;
          myStatus.returnTime = null;
        } else {
          myStatus.returnTime = result.record.returnTime;
        }
        // 로컬 업데이트
        for (var i = 0; i < todayAttendance.length; i++) {
          if (todayAttendance[i].id === result.record.id) {
            todayAttendance[i] = result.record;
            break;
          }
        }
        updateClockStatus();
        showToast(result.message, 'success');
      } else {
        showToast(result.message, 'error');
        document.getElementById(btnId).disabled = false;
      }
    })
    .withFailureHandler(function(err) {
      showToast('서버 오류: ' + err.message, 'error');
      document.getElementById(btnId).disabled = false;
    })
    .recordOutReturn({ type: type });
  });
}

// ============ 내 출퇴근 기록 ============
function loadMyAttendance() {
  // date range 기반 (myAttStart / myAttEnd) 또는 legacy month 기반
  var startEl = document.getElementById('myAttStart');
  var endEl = document.getElementById('myAttEnd');
  var startDate, endDate;

  if (startEl && startEl.value) {
    startDate = startEl.value;
    endDate = endEl ? endEl.value : startDate;
  } else {
    // 초기값 설정: 최근 7일
    var d = new Date(); d.setDate(d.getDate() - 7);
    startDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var now = new Date();
    endDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    if (startEl) startEl.value = startDate;
    if (endEl) endEl.value = endDate;
  }
  if (!startDate || !endDate) return;

  // 비차단 인라인 스피너 (전체 오버레이 없음)
  document.getElementById('myAttendanceList').innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray-400);"><i class="fas fa-spinner fa-spin" style="font-size:20px;"></i></div>';
  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        renderMyAttendance(result.data);
      } else {
        document.getElementById('myAttendanceList').innerHTML =
          '<div class="empty-state"><i class="fas fa-clock"></i><p>' + (result.message || '조회 실패') + '</p></div>';
      }
    })
    .withFailureHandler(function(err) {
      hideLoading();
      showToast('서버 오류: ' + err.message, 'error');
    })
    .getMyAttendance({ startDate: startDate, endDate: endDate });
}

function renderMyAttendance(records) {
  var container = document.getElementById('myAttendanceList');
  if (records.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-clock"></i><h3>기록 없음</h3><p>해당 월의 출퇴근 기록이 없습니다.</p></div>';
    return;
  }

  var totalHours = 0;
  var totalOvertime = 0;
  var html = '<div class="table-wrapper"><table><thead><tr><th>날짜</th><th>출근</th><th>퇴근</th><th>외출</th><th>복귀</th><th>실근무</th><th>연장</th><th>상태</th></tr></thead><tbody>';
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    totalHours += r.netHours;
    totalOvertime += r.overtimeHours;
    html += '<tr>' +
      '<td>' + r.date + '</td>' +
      '<td>' + (r.clockIn || '-') + '</td>' +
      '<td>' + (r.clockOut || '-') + '</td>' +
      '<td>' + (r.outTime || '-') + '</td>' +
      '<td>' + (r.returnTime || '-') + '</td>' +
      '<td>' + r.netHours.toFixed(1) + 'h</td>' +
      '<td>' + (r.overtimeHours > 0 ? r.overtimeHours.toFixed(1) + 'h' : '-') + '</td>' +
      '<td><span class="status-badge ' + r.status + '">' + r.status + '</span></td>' +
    '</tr>';
  }
  html += '</tbody></table></div>';
  html += '<div style="margin-top:12px;padding:12px;background:var(--gray-50);border-radius:var(--radius-sm);display:flex;gap:24px;font-size:13px;">' +
    '<span>근무일: <strong>' + records.length + '일</strong></span>' +
    '<span>총 근무시간: <strong>' + totalHours.toFixed(1) + 'h</strong></span>' +
    '<span>연장시간: <strong>' + totalOvertime.toFixed(1) + 'h</strong></span>' +
  '</div>';
  container.innerHTML = html;
}

// ============ 출퇴근 관리자 팀원 현황 ============
var _clockAdminInited = false;

function initClockAdmin() {
  if (!isSuperAdmin() && !isManager()) return;
  var section = document.getElementById('clockAdminSection');
  if (!section) return;
  section.style.display = '';

  if (!_clockAdminInited) {
    var orgSel = document.getElementById('clockAdminOrg');
    if (orgSel.options.length <= 1) {
      organizations.forEach(function(org) {
        orgSel.innerHTML += '<option value="' + org + '">' + org + '</option>';
      });
    }
    var empSel = document.getElementById('clockAdminEmp');
    if (empSel.options.length <= 1) {
      var sorted = allEmployees.slice().sort(function(a, b) { return a.name.localeCompare(b.name); });
      for (var i = 0; i < sorted.length; i++) {
        empSel.innerHTML += '<option value="' + sorted[i].id + '">' + sorted[i].name + '</option>';
      }
    }
    _clockAdminInited = true;
    setAdminPeriod('day'); // 기본: 오늘
  }
}

var _adminPeriodType = 'day';
function setAdminPeriod(type) {
  _adminPeriodType = type;
  ['Day', 'Week', 'Month'].forEach(function(t) {
    var btn = document.getElementById('adminPeriod' + t);
    if (btn) btn.classList.toggle('active', t.toLowerCase() === type);
  });
  var now = new Date();
  var startEl = document.getElementById('clockAdminStart');
  var endEl = document.getElementById('clockAdminEnd');
  var y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };

  if (type === 'day') {
    var today = y + '-' + pad(m + 1) + '-' + pad(d);
    startEl.value = today; endEl.value = today;
  } else if (type === 'week') {
    var mon = new Date(now); mon.setDate(d - now.getDay() + (now.getDay() === 0 ? -6 : 1));
    var sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    startEl.value = mon.getFullYear() + '-' + pad(mon.getMonth() + 1) + '-' + pad(mon.getDate());
    endEl.value = sun.getFullYear() + '-' + pad(sun.getMonth() + 1) + '-' + pad(sun.getDate());
  } else {
    startEl.value = y + '-' + pad(m + 1) + '-01';
    var last = new Date(y, m + 1, 0).getDate();
    endEl.value = y + '-' + pad(m + 1) + '-' + pad(last);
  }
  loadClockAdminData();
}

function loadClockAdminData() {
  var startDate = document.getElementById('clockAdminStart').value;
  var endDate = document.getElementById('clockAdminEnd').value;
  if (!startDate || !endDate) return;
  var orgFilter = document.getElementById('clockAdminOrg').value;
  var empFilter = document.getElementById('clockAdminEmp') ? document.getElementById('clockAdminEmp').value : '';

  var filters = { startDate: startDate, endDate: endDate };
  if (orgFilter) filters.org = orgFilter;
  if (empFilter) filters.employeeId = empFilter;
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        renderClockAdminList(result.data);
      } else {
        document.getElementById('clockAdminList').innerHTML =
          '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>' + (result.message || '조회 실패') + '</p></div>';
      }
    })
    .withFailureHandler(function(err) {
      hideLoading();
      document.getElementById('clockAdminList').innerHTML =
        '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>서버 오류: ' + err.message + '</p></div>';
    })
    .getAttendanceList(filters);
}

function renderClockAdminList(records) {
  var container = document.getElementById('clockAdminList');

  // 오늘 날짜인지 확인 (대리 출퇴근 버튼 표시 여부)
  var todayStr = new Date().getFullYear() + '-' +
    String(new Date().getMonth() + 1).padStart(2, '0') + '-' +
    String(new Date().getDate()).padStart(2, '0');
  var isToday = document.getElementById('clockAdminStart').value === todayStr &&
    document.getElementById('clockAdminEnd').value === todayStr;

  // 오늘 기록이 있는 직원 ID 맵
  var clockedEmpIds = {};
  if (isToday) {
    for (var k = 0; k < records.length; k++) {
      if (records[k].clockIn) clockedEmpIds[records[k].employeeId] = records[k];
    }
  }

  // 오늘+미출근 직원 목록 표시
  var adminHtml = '';
  if (isToday && (isSuperAdmin() || isManager())) {
    var notClockedIn = [];
    for (var j = 0; j < allEmployees.length; j++) {
      if (!clockedEmpIds[allEmployees[j].id]) {
        notClockedIn.push(allEmployees[j]);
      }
    }
    if (notClockedIn.length > 0) {
      adminHtml = '<div style="padding:8px 12px;background:#FFF8E1;border-radius:6px;margin-bottom:8px;">' +
        '<div style="font-size:12px;font-weight:600;color:#F57F17;margin-bottom:6px;">' +
        '<i class="fas fa-exclamation-triangle"></i> 미출근 ' + notClockedIn.length + '명</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
      for (var n = 0; n < notClockedIn.length; n++) {
        var ne = notClockedIn[n];
        adminHtml += '<button class="btn btn-outline btn-sm" style="font-size:11px;padding:2px 8px;" ' +
          'onclick="adminProxyClockIn(\'' + ne.id + '\',\'' + ne.name + '\')">' +
          '<i class="fas fa-sign-in-alt" style="color:var(--primary);"></i> ' + ne.name + '</button>';
      }
      adminHtml += '</div></div>';
    }
  }

  if (records.length === 0 && !adminHtml) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><p>해당 기간 출퇴근 기록이 없습니다.</p></div>';
    return;
  }

  var html = adminHtml;
  if (records.length > 0) {
    html += '<div class="table-wrapper"><table><thead><tr><th>날짜</th><th>직원</th><th>조직</th><th>출근</th><th>퇴근</th><th>외출</th><th>실근무</th><th>상태</th><th>관리</th></tr></thead><tbody>';
    var limit = Math.min(records.length, 100);
    for (var i = 0; i < limit; i++) {
      var r = records[i];
      var outInfo = r.outTime ? (r.outTime + (r.returnTime ? '~' + r.returnTime : '~')) : '-';
      var actionBtn = '';
      if (isToday && r.clockIn && !r.clockOut) {
        actionBtn = '<button class="btn btn-outline btn-sm" style="font-size:11px;padding:2px 6px;" ' +
          'onclick="adminProxyClockOut(\'' + r.id + '\',\'' + r.employeeName + '\')"><i class="fas fa-sign-out-alt" style="color:var(--danger);"></i> 퇴근</button>';
      }
      html += '<tr><td>' + r.date + '</td><td>' + r.employeeName + '</td><td>' + r.org + '</td>' +
        '<td>' + (r.clockIn || '-') + '</td><td>' + (r.clockOut || '-') + '</td>' +
        '<td>' + outInfo + '</td>' +
        '<td>' + (r.netHours || 0).toFixed(1) + 'h</td>' +
        '<td><span class="status-badge ' + r.status + '">' + r.status + '</span></td>' +
        '<td>' + actionBtn + '</td></tr>';
    }
    html += '</tbody></table></div>';
    if (records.length > 100) html += '<p style="text-align:center;font-size:12px;color:var(--gray-500);">최근 100건만 표시 (전체 ' + records.length + '건)</p>';
  }
  container.innerHTML = html;
}

function adminProxyClockIn(empId, empName) {
  showConfirm(empName + ' 님을 대리 출근 처리하시겠습니까?', 'in', function() {
    showLoading();
    google.script.run
      .withSuccessHandler(function(result) {
        hideLoading();
        if (result.success) {
          showToast(empName + ' 출근 처리 완료', 'success');
          loadClockAdminData();
        } else {
          showToast(result.message, 'error');
        }
      })
      .withFailureHandler(function(err) { hideLoading(); showToast('오류: ' + err.message, 'error'); })
      .adminClockIn(empId);
  });
}

function adminProxyClockOut(recordId, empName) {
  showConfirm(empName + ' 님을 대리 퇴근 처리하시겠습니까?', 'out', function() {
    showLoading();
    google.script.run
      .withSuccessHandler(function(result) {
        hideLoading();
        if (result.success) {
          showToast(empName + ' 퇴근 처리 완료', 'success');
          loadClockAdminData();
        } else {
          showToast(result.message, 'error');
        }
      })
      .withFailureHandler(function(err) { hideLoading(); showToast('오류: ' + err.message, 'error'); })
      .adminClockOut(recordId);
  });
}

// ============ 출퇴근기록 (달력형 + 목록형) ============
var attRecView = 'calendar';
var attRecData = [];
var attRecLeaves = [];
var attRecSchedules = [];
var attListData = [];
var attListFiltered = [];
var attListPage = 1;
var earlyThreshold = 10;
var attListPageSize = 25;
var _attRecEditingId = null;
var _attRecInited = false;

function initAttRecordPage() {
  if (!_attRecInited) {
    var now = new Date();
    var monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    document.getElementById('attRecMonth').value = monthStr;
    if (isEmployeeRole()) {
      // 직원은 조직필터 숨김
      document.getElementById('attRecOrg').style.display = 'none';
    } else {
      // 조직 필터 초기화
      var orgSel = document.getElementById('attRecOrg');
      if (orgSel.options.length <= 1) {
        organizations.forEach(function(org) {
          orgSel.innerHTML += '<option value="' + org + '">' + org + '</option>';
        });
      }
    }
    // 관리자이면 직원 필터 표시
    if (userRole === '최고관리자' || userRole === '총괄관리자') {
      document.getElementById('attRecEmployee').style.display = '';
      document.getElementById('attRecSearch').style.display = '';
      var empSel = document.getElementById('attRecEmployee');
      if (empSel.options.length <= 1) {
        var sorted = allEmployees.slice().sort(function(a, b) { return a.name.localeCompare(b.name); });
        for (var i = 0; i < sorted.length; i++) {
          empSel.innerHTML += '<option value="' + sorted[i].id + '">' + sorted[i].name + ' (' + sorted[i].org + ')</option>';
        }
      }
    }
    _attRecInited = true;
  }
  loadAttRecordData();
}

function filterAttRecordLocal() {
  var empFilter = document.getElementById('attRecEmployee').value;
  var search = (document.getElementById('attRecSearch').value || '').trim().toLowerCase();

  if (!empFilter && !search) {
    renderAttCalendar();
    return;
  }

  // 로컬 필터링 후 다시 렌더링
  renderAttCalendar(empFilter, search);
}

var ORG_COLORS = {
  '검토팀': '#7B1FA2', '분류팀': '#E91E63', '뉴터칭콜팀': '#9C27B0',
  '인용확인팀': '#AB47BC', '작성팀': '#4CAF50', '신고팀': '#1565C0', '고객지원팀': '#00838F'
};

function switchAttView(view) {
  attRecView = view;
  document.getElementById('attViewCal').classList.toggle('active', view === 'calendar');
  document.getElementById('attViewList').classList.toggle('active', view === 'list');
  document.getElementById('attCalendarView').style.display = view === 'calendar' ? '' : 'none';
  document.getElementById('attListView').style.display = view === 'list' ? '' : 'none';
  if (view === 'list') {
    initAttListDates_();
    loadAttListData();
  }
}

function initAttListDates_() {
  var startEl = document.getElementById('attListStart');
  var endEl = document.getElementById('attListEnd');
  if (startEl && !startEl.value) {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, '0');
    var d = String(now.getDate()).padStart(2, '0');
    startEl.value = y + '-' + m + '-01';
    endEl.value = y + '-' + m + '-' + d;
  }
}

function loadAttRecordData() {
  var monthVal = document.getElementById('attRecMonth').value;
  if (!monthVal) return;
  showLoading();

  var parts = monthVal.split('-');
  var year = parseInt(parts[0]);
  var month = parseInt(parts[1]);
  var startDate = monthVal + '-01';
  var lastDay = new Date(year, month, 0).getDate();
  var endDate = monthVal + '-' + String(lastDay).padStart(2, '0');
  var orgFilter = document.getElementById('attRecOrg').value;

  var pending = 3;
  var done = function() { pending--; if (pending === 0) { hideLoading(); renderAttCalendar(); } };

  var filters = { startDate: startDate, endDate: endDate };
  if (orgFilter) filters.org = orgFilter;

  if (isEmployeeRole()) {
    // 직원은 본인 데이터만 조회
    google.script.run.withSuccessHandler(function(r) {
      attRecData = r.success ? r.data : []; done();
    }).withFailureHandler(function() { attRecData = []; done(); })
      .getMyAttendance(filters);

    google.script.run.withSuccessHandler(function(r) {
      attRecLeaves = r.success ? r.data : []; done();
    }).withFailureHandler(function() { attRecLeaves = []; done(); })
      .getMyLeaves(filters);

    google.script.run.withSuccessHandler(function(r) {
      attRecSchedules = r.success ? r.data : []; done();
    }).withFailureHandler(function() { attRecSchedules = []; done(); })
      .getMySchedule(filters);
  } else {
    google.script.run.withSuccessHandler(function(r) {
      attRecData = r.success ? r.data : []; done();
    }).withFailureHandler(function() { attRecData = []; done(); })
      .getAttendanceList(filters);

    google.script.run.withSuccessHandler(function(r) {
      attRecLeaves = r.success ? r.data : []; done();
    }).withFailureHandler(function() { attRecLeaves = []; done(); })
      .getLeaveList(filters);

    google.script.run.withSuccessHandler(function(r) {
      attRecSchedules = r.success ? r.data : []; done();
    }).withFailureHandler(function() { attRecSchedules = []; done(); })
      .getScheduleList(filters);
  }
}

function renderAttCalendar(empIdFilter, searchFilter) {
  var monthVal = document.getElementById('attRecMonth').value;
  if (!monthVal) return;
  var container = document.getElementById('attGridContainer');
  var parts = monthVal.split('-');
  var year = parseInt(parts[0]);
  var month = parseInt(parts[1]);
  var daysInMonth = new Date(year, month, 0).getDate();
  var orgFilter = document.getElementById('attRecOrg').value;
  var lateThreshold = parseInt(document.getElementById('attLateThreshold').value) || 10;
  var showLeave = document.getElementById('attShowLeave').checked;

  // 직원 목록 필터
  var emps = allEmployees.filter(function(e) {
    if (e.status !== '재직') return false;
    if (orgFilter && e.org !== orgFilter) return false;
    if (empIdFilter && e.id !== empIdFilter) return false;
    if (searchFilter && e.name.toLowerCase().indexOf(searchFilter) === -1) return false;
    return true;
  }).sort(function(a, b) { return a.name.localeCompare(b.name); });

  if (emps.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><p>해당 조직에 직원이 없습니다.</p></div>';
    return;
  }

  // 인덱스 맵 생성
  var attMap = {};
  attRecData.forEach(function(r) {
    var key = r.employeeId + '_' + r.date;
    attMap[key] = r;
  });

  var leaveMap = {};
  attRecLeaves.forEach(function(lv) {
    var s = new Date(lv.startDate);
    var e = new Date(lv.endDate);
    for (var d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      var ds = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      var key = lv.employeeId + '_' + ds;
      if (!leaveMap[key]) leaveMap[key] = [];
      leaveMap[key].push(lv);
    }
  });

  var schedMap = {};
  attRecSchedules.forEach(function(sc) {
    var key = sc.employeeId + '_' + sc.date;
    schedMap[key] = sc;
  });

  var totalHours = 0;
  var totalPay = 0;

  // 헤더 행
  var html = '<table class="att-grid-table"><thead><tr>';
  html += '<th class="att-emp-col">직원</th>';
  for (var d = 1; d <= daysInMonth; d++) {
    var dt = new Date(year, month - 1, d);
    var dow = dt.getDay();
    var dayStr = year + '-' + String(month).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    var isHoliday = HOLIDAYS_2026.indexOf(dayStr) !== -1;
    var cls = dow === 0 ? 'sunday' : (dow === 6 ? 'saturday' : '');
    if (isHoliday) cls = 'holiday';
    var dayNames = ['일','월','화','수','목','금','토'];
    html += '<th class="att-day-header ' + cls + '">' + d + '<br>' + dayNames[dow] + '</th>';
  }
  html += '<th class="att-sum-col">합계</th>';
  html += '</tr></thead><tbody>';

  // 각 직원 행
  for (var ei = 0; ei < emps.length; ei++) {
    var emp = emps[ei];
    var empDays = 0;
    html += '<tr>';
    html += '<td class="att-emp-col"><div class="att-emp-name">' + emp.name + '</div><div class="att-emp-id">' + emp.id + '</div></td>';

    for (var d = 1; d <= daysInMonth; d++) {
      var dayStr = year + '-' + String(month).padStart(2,'0') + '-' + String(d).padStart(2,'0');
      var dt = new Date(year, month - 1, d);
      var dow = dt.getDay();
      var isHoliday = HOLIDAYS_2026.indexOf(dayStr) !== -1;
      var isWeekend = (dow === 0 || dow === 6);

      var attKey = emp.id + '_' + dayStr;
      var rec = attMap[attKey];
      var leaves = leaveMap[attKey];
      var sched = schedMap[attKey];

      var cellClass = 'att-day-cell';
      if (isHoliday) cellClass += ' holiday-cell';
      else if (isWeekend) cellClass += ' weekend-cell';
      else if (!rec && !leaves && sched) cellClass += ' no-record';

      var cellContent = '';

      if (rec) {
        empDays++;
        var clockIn = rec.clockIn || '';
        var clockOut = rec.clockOut || '';
        var schedStart = rec.schedStart || (sched ? sched.startTime : '');
        var schedEnd = rec.schedEnd || (sched ? sched.endTime : '');

        // 지각 판정
        var inClass = 'normal';
        if (clockIn && schedStart) {
          var diff = timeDiffMin_(clockIn, schedStart);
          if (diff > lateThreshold) inClass = 'late';
        }

        // 조퇴 판정
        var outClass = 'normal';
        if (clockOut && schedEnd) {
          var diffOut = timeDiffMin_(schedEnd, clockOut);
          if (diffOut > earlyThreshold) outClass = 'early';
        }

        cellContent += '<div class="att-time ' + inClass + '">' + (clockIn || '-') + '</div>';
        if (clockOut) {
          cellContent += '<div class="att-time ' + outClass + '">' + clockOut + '</div>';
        } else if (clockIn) {
          cellContent += '<span class="att-miss-badge">1</span>';
        }

        totalHours += (rec.totalMinutes || 0) / 60;
        totalPay += rec.pay || 0;

        // 조직 색상 바
        var orgColor = ORG_COLORS[rec.org] || '#999';
        cellContent += '<div class="att-org-bar" style="background:' + orgColor + ';"></div>';
      }

      if (showLeave && leaves && leaves.length > 0) {
        for (var li = 0; li < leaves.length; li++) {
          var lvType = leaves[li].leaveType || '';
          var shortLabel = lvType === '연차' ? '연차' :
            lvType === '여성휴가' ? '여휴(무)' :
            lvType === '병가' ? '병가' :
            lvType === '경조사' ? '경조' :
            lvType === '공휴일' ? '공휴' : lvType;
          cellContent += '<div class="att-leave-label">' + shortLabel + '</div>';
        }
      }

      html += '<td class="' + cellClass + '" onclick="onAttCellClick(\'' + emp.id + '\',\'' + dayStr + '\')">' + cellContent + '</td>';
    }

    html += '<td class="att-sum-col">' + empDays + '</td>';
    html += '</tr>';
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  // 합계 표시
  document.getElementById('attTotalHours').textContent = totalHours.toFixed(1) + 'h';
  document.getElementById('attTotalPay').textContent = '₩' + Math.round(totalPay).toLocaleString();
}

function timeDiffMin_(timeA, timeB) {
  var a = timeA.split(':');
  var b = timeB.split(':');
  if (a.length < 2 || b.length < 2) return 0;
  return (parseInt(a[0]) * 60 + parseInt(a[1])) - (parseInt(b[0]) * 60 + parseInt(b[1]));
}

function onAttCellClick(empId, date) {
  var key = empId + '_' + date;
  var rec = null;
  for (var i = 0; i < attRecData.length; i++) {
    if (attRecData[i].employeeId === empId && attRecData[i].date === date) {
      rec = attRecData[i]; break;
    }
  }
  if (rec) {
    openEditAttRecordModal(rec);
  } else {
    openAddAttRecordModal(empId, date);
  }
}

// ============ 출퇴근기록 목록형 ============
function loadAttListData() {
  var startDate = document.getElementById('attListStart').value;
  var endDate = document.getElementById('attListEnd').value;
  if (!startDate || !endDate) return;
  var orgFilter = document.getElementById('attRecOrg').value;
  var filters = { startDate: startDate, endDate: endDate };
  if (orgFilter) filters.org = orgFilter;

  showLoading();
  var handler = function(r) {
    hideLoading();
    attListData = r.success ? r.data : [];
    attListFiltered = attListData.slice();
    attListPage = 1;
    renderAttList();
  };
  var errHandler2 = function(err) {
    hideLoading();
    showToast('조회 실패: ' + err.message, 'error');
  };

  if (isEmployeeRole()) {
    google.script.run.withSuccessHandler(handler).withFailureHandler(errHandler2).getMyAttendance(filters);
  } else {
    google.script.run.withSuccessHandler(handler).withFailureHandler(errHandler2).getAttendanceList(filters);
  }
}

function filterAttListLocal() {
  var q = (document.getElementById('attListSearch').value || '').toLowerCase();
  attListFiltered = attListData.filter(function(r) {
    if (!q) return true;
    return (r.employeeName || '').toLowerCase().indexOf(q) !== -1 ||
           (r.employeeId || '').toLowerCase().indexOf(q) !== -1;
  });
  attListPage = 1;
  renderAttList();
}

function renderAttList() {
  var container = document.getElementById('attListContainer');
  if (attListFiltered.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-clipboard-list"></i><p>출퇴근 기록이 없습니다.</p></div>';
    document.getElementById('attListPagination').innerHTML = '';
    return;
  }

  var totalH = 0, totalPay = 0;
  attListFiltered.forEach(function(r) { totalH += (r.totalMinutes || 0) / 60; totalPay += r.pay || 0; });
  document.getElementById('attTotalHours').textContent = totalH.toFixed(1) + 'h';
  document.getElementById('attTotalPay').textContent = '₩' + Math.round(totalPay).toLocaleString();

  var start = (attListPage - 1) * attListPageSize;
  var pageData = attListFiltered.slice(start, start + attListPageSize);

  var html = '<table class="att-list-table"><thead><tr>' +
    '<th>사원번호</th><th>직원</th><th>날짜</th><th>근무시간</th><th>근무일정</th>' +
    '<th>조직</th><th>직무</th><th>출근장소</th><th>퇴근장소</th><th>근무노트</th>' +
    '<th>휴게</th><th>총시간</th><th>일정오차</th><th>출근오차</th><th>퇴근오차</th>' +
    '<th>급여</th><th>확정</th><th>수정일</th><th>생성일</th>' +
    '</tr></thead><tbody>';

  for (var i = 0; i < pageData.length; i++) {
    var r = pageData[i];
    var workTimeStr = (r.clockIn || '-') + ' - ' + (r.clockOut || '-');
    if (r.outTime) workTimeStr += ' <span style="color:#FF9800;font-size:10px;">[외출 ' + r.outTime + (r.returnTime ? '~' + r.returnTime : '~') + ']</span>';
    var schedTimeStr = (r.schedStart || '-') + ' - ' + (r.schedEnd || '-');
    var totalMinStr = formatMinutes_(r.totalMinutes || 0);
    var breakStr = (r.breakMinutes || 60) + '분';
    var schedVar = calcVariance_(r.totalMinutes, r.schedStart, r.schedEnd, r.breakMinutes);
    var inVar = calcTimeVariance_(r.clockIn, r.schedStart);
    var outVar = calcTimeVariance_(r.clockOut, r.schedEnd);

    html += '<tr onclick="openEditAttRecordModal(attListFiltered[' + (start + i) + '])">' +
      '<td>' + r.employeeId + '</td>' +
      '<td><strong>' + r.employeeName + '</strong></td>' +
      '<td>' + r.date + '</td>' +
      '<td>' + workTimeStr + '</td>' +
      '<td style="font-size:11px;">' + schedTimeStr + '</td>' +
      '<td>' + (r.org || '') + '</td>' +
      '<td>' + (r.duty || '') + '</td>' +
      '<td style="font-size:11px;">' + (r.clockInLocation || '-') + '</td>' +
      '<td style="font-size:11px;">' + (r.clockOutLocation || '-') + '</td>' +
      '<td style="font-size:11px;">' + (r.note || '') + '</td>' +
      '<td>' + breakStr + '</td>' +
      '<td>' + totalMinStr + '</td>' +
      '<td class="' + (schedVar.cls) + '">' + schedVar.text + '</td>' +
      '<td class="' + (inVar.cls) + '">' + inVar.text + '</td>' +
      '<td class="' + (outVar.cls) + '">' + outVar.text + '</td>' +
      '<td>₩' + (r.pay || 0).toLocaleString() + '</td>' +
      '<td>' + (r.confirmed === 'Y' ? '✓' : '') + '</td>' +
      '<td style="font-size:10px;">' + (r.updatedAt || '') + '</td>' +
      '<td style="font-size:10px;">' + (r.createdAt || '') + '</td>' +
    '</tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;

  // 페이지네이션
  var totalPages = Math.ceil(attListFiltered.length / attListPageSize);
  var pagHtml = '';
  if (totalPages > 1) {
    pagHtml += '<button class="btn btn-outline btn-sm" onclick="attListGoPage(' + (attListPage - 1) + ')" ' + (attListPage <= 1 ? 'disabled' : '') + '>&lt;</button>';
    for (var p = 1; p <= totalPages; p++) {
      pagHtml += '<button class="btn btn-sm ' + (p === attListPage ? 'btn-primary' : 'btn-outline') + '" onclick="attListGoPage(' + p + ')">' + p + '</button>';
    }
    pagHtml += '<button class="btn btn-outline btn-sm" onclick="attListGoPage(' + (attListPage + 1) + ')" ' + (attListPage >= totalPages ? 'disabled' : '') + '>&gt;</button>';
    pagHtml += '<span style="font-size:12px;color:var(--gray-500);margin-left:8px;">' + attListPageSize + '건/페이지</span>';
  }
  document.getElementById('attListPagination').innerHTML = pagHtml;
}

function attListGoPage(p) {
  var totalPages = Math.ceil(attListFiltered.length / attListPageSize);
  if (p < 1 || p > totalPages) return;
  attListPage = p;
  renderAttList();
}

function formatMinutes_(min) {
  if (!min || min <= 0) return '-';
  var h = Math.floor(min / 60);
  var m = min % 60;
  return h + '시간' + (m > 0 ? ' ' + m + '분' : '');
}

function calcVariance_(totalMin, schedStart, schedEnd, breakMin) {
  if (!schedStart || !schedEnd || !totalMin) return { text: '-', cls: '' };
  var sp = schedStart.split(':');
  var ep = schedEnd.split(':');
  var schedMin = (parseInt(ep[0]) * 60 + parseInt(ep[1])) - (parseInt(sp[0]) * 60 + parseInt(sp[1])) - (breakMin || 60);
  var diff = totalMin - schedMin;
  if (diff === 0) return { text: '0', cls: '' };
  var sign = diff > 0 ? '+' : '';
  var absDiff = Math.abs(diff);
  var h = Math.floor(absDiff / 60);
  var m = absDiff % 60;
  var text = sign + (h > 0 ? h + '시간 ' : '') + m + '분';
  return { text: text, cls: diff < 0 ? 'variance-negative' : 'variance-positive' };
}

function calcTimeVariance_(actual, scheduled) {
  if (!actual || !scheduled) return { text: '-', cls: '' };
  var a = actual.split(':');
  var s = scheduled.split(':');
  if (a.length < 2 || s.length < 2) return { text: '-', cls: '' };
  var diff = (parseInt(a[0]) * 60 + parseInt(a[1])) - (parseInt(s[0]) * 60 + parseInt(s[1]));
  if (diff === 0) return { text: '0', cls: '' };
  var sign = diff > 0 ? '+' : '';
  var absDiff = Math.abs(diff);
  var h = Math.floor(absDiff / 60);
  var m = absDiff % 60;
  var text = sign + (h > 0 ? h + '시간 ' : '') + m + '분';
  return { text: text, cls: diff > 0 ? 'variance-negative' : 'variance-positive' };
}

// ============ 출퇴근기록 모달 ============
function openAddAttRecordModal(empId, date) {
  _attRecEditingId = null;
  document.getElementById('attRecordModalTitle').textContent = '출퇴근기록 추가하기';
  document.getElementById('attRecSaveLabel').textContent = '추가하기';
  document.getElementById('attRecDeleteBtn').style.display = 'none';
  document.getElementById('attRecEditId').value = '';
  document.getElementById('attRecDate').value = date || new Date().toISOString().substr(0, 10);
  document.getElementById('attRecClockIn').value = '09:00';
  document.getElementById('attRecClockOut').value = '18:00';
  document.getElementById('attRecNote').value = '';
  document.getElementById('attRecStatus').value = '정상';
  document.getElementById('attRecConfirmed').checked = false;
  document.getElementById('attRecLocIn').value = '';
  document.getElementById('attRecLocOut').value = '';
  document.getElementById('attRecCreatedAt').textContent = '';
  document.getElementById('attRecSchedInfo').textContent = '일정 없음';

  var empSel = document.getElementById('attRecEmployee');
  empSel.innerHTML = '<option value="">-- 직원 선택 --</option>';
  allEmployees.filter(function(e) { return e.status === '재직'; }).forEach(function(e) {
    empSel.innerHTML += '<option value="' + e.id + '"' + (empId === e.id ? ' selected' : '') + '>' + e.name + ' (' + e.id + ')</option>';
  });
  if (empId) {
    empSel.value = empId;
    onAttRecEmployeeChange();
  }
  document.getElementById('attRecordModal').classList.add('active');
}

function openEditAttRecordModal(rec) {
  _attRecEditingId = rec.id;
  document.getElementById('attRecordModalTitle').textContent = '출퇴근기록 수정하기';
  document.getElementById('attRecSaveLabel').textContent = '변경사항 저장';
  document.getElementById('attRecDeleteBtn').style.display = '';
  document.getElementById('attRecEditId').value = rec.id;
  document.getElementById('attRecDate').value = rec.date || '';
  document.getElementById('attRecClockIn').value = rec.clockIn || '';
  document.getElementById('attRecClockOut').value = rec.clockOut || '';
  document.getElementById('attRecNote').value = rec.note || '';
  document.getElementById('attRecStatus').value = rec.status || '정상';
  document.getElementById('attRecConfirmed').checked = rec.confirmed === 'Y';
  document.getElementById('attRecLocIn').value = rec.clockInLocation || '';
  document.getElementById('attRecLocOut').value = rec.clockOutLocation || '';
  document.getElementById('attRecOrg2').value = rec.org || '';
  document.getElementById('attRecDuty').value = rec.duty || '경정청구팀';
  document.getElementById('attRecCreatedAt').textContent = rec.createdAt ? '생성일자: ' + rec.createdAt : '';

  var schedStr = rec.schedStart && rec.schedEnd ?
    '(' + rec.date + ') ' + rec.schedStart + ' - ' + rec.schedEnd + ' / ' + (rec.org || '') + ' / ' + (rec.duty || '') :
    '일정 없음';
  document.getElementById('attRecSchedInfo').textContent = schedStr;

  var empSel = document.getElementById('attRecEmployee');
  empSel.innerHTML = '<option value="">-- 직원 선택 --</option>';
  allEmployees.filter(function(e) { return e.status === '재직'; }).forEach(function(e) {
    empSel.innerHTML += '<option value="' + e.id + '"' + (rec.employeeId === e.id ? ' selected' : '') + '>' + e.name + ' (' + e.id + ')</option>';
  });

  document.getElementById('attRecordModal').classList.add('active');
}

function onAttRecEmployeeChange() {
  var empId = document.getElementById('attRecEmployee').value;
  var emp = allEmployees.find(function(e) { return e.id === empId; });
  if (emp) {
    document.getElementById('attRecOrg2').value = emp.org || '';
    document.getElementById('attRecDuty').value = emp.duty || '경정청구팀';
  }
}

function closeAttRecordModal() {
  document.getElementById('attRecordModal').classList.remove('active');
}

function saveAttRecord() {
  var editId = document.getElementById('attRecEditId').value;
  var empId = document.getElementById('attRecEmployee').value;
  if (!empId) { showToast('직원을 선택해주세요.', 'error'); return; }

  var emp = allEmployees.find(function(e) { return e.id === empId; });
  var data = {
    employeeId: empId,
    employeeName: emp ? emp.name : '',
    org: document.getElementById('attRecOrg2').value,
    duty: document.getElementById('attRecDuty').value,
    date: document.getElementById('attRecDate').value,
    clockIn: document.getElementById('attRecClockIn').value,
    clockOut: document.getElementById('attRecClockOut').value,
    note: document.getElementById('attRecNote').value,
    status: document.getElementById('attRecStatus').value,
    confirmed: document.getElementById('attRecConfirmed').checked ? 'Y' : 'N'
  };

  showLoading();
  if (editId) {
    data.id = editId;
    google.script.run.withSuccessHandler(function(r) {
      hideLoading();
      if (r.success) {
        showToast(r.message, 'success');
        closeAttRecordModal();
        loadAttRecordData();
      } else {
        showToast(r.message, 'error');
      }
    }).withFailureHandler(function(err) {
      hideLoading(); showToast('오류: ' + err.message, 'error');
    }).updateAttendance(data);
  } else {
    google.script.run.withSuccessHandler(function(r) {
      hideLoading();
      if (r.success) {
        showToast(r.message, 'success');
        closeAttRecordModal();
        loadAttRecordData();
      } else {
        showToast(r.message, 'error');
      }
    }).withFailureHandler(function(err) {
      hideLoading(); showToast('오류: ' + err.message, 'error');
    }).addAttendanceManual(data);
  }
}

function deleteAttRecord() {
  var editId = document.getElementById('attRecEditId').value;
  if (!editId) return;
  if (!confirm('이 출퇴근 기록을 삭제하시겠습니까?')) return;

  showLoading();
  google.script.run.withSuccessHandler(function(r) {
    hideLoading();
    if (r.success) {
      showToast('삭제되었습니다.', 'success');
      closeAttRecordModal();
      loadAttRecordData();
    } else {
      showToast(r.message, 'error');
    }
  }).withFailureHandler(function(err) {
    hideLoading(); showToast('오류: ' + err.message, 'error');
  }).deleteAttendance(editId);
}

// ============ 근무일정 (달력 + 목록) ============
var scheduleView = 'calendar';
var scheduleListData = [];
var scheduleListFiltered = [];
var scheduleListPageSize = 25;
var scheduleListCurrentPage = 1;
var _scheduleCache = null;

// 2026년 한국 공휴일
var HOLIDAYS_2026 = [
  '2026-01-01', '2026-01-28', '2026-01-29', '2026-01-30',
  '2026-03-01', '2026-05-05', '2026-05-24', '2026-06-06',
  '2026-08-15', '2026-09-24', '2026-09-25', '2026-09-26',
  '2026-10-03', '2026-10-09', '2026-12-25'
];

function switchScheduleView(view) {
  scheduleView = view;
  document.getElementById('schedViewDay').classList.toggle('active', view === 'day');
  document.getElementById('schedViewWeek').classList.toggle('active', view === 'week');
  document.getElementById('schedViewCal').classList.toggle('active', view === 'calendar');
  document.getElementById('schedViewList').classList.toggle('active', view === 'list');
  document.getElementById('scheduleDayView').style.display = view === 'day' ? '' : 'none';
  document.getElementById('scheduleWeekView').style.display = view === 'week' ? '' : 'none';
  document.getElementById('scheduleCalendarView').style.display = view === 'calendar' ? '' : 'none';
  document.getElementById('scheduleListView').style.display = view === 'list' ? '' : 'none';

  if (view === 'day') {
    loadDailySchedule();
  } else if (view === 'week') {
    loadWeeklySchedule();
  } else if (view === 'list') {
    initScheduleListDates_();
    loadScheduleList();
  }
}

// ============ 일간 타임라인 뷰 ============

var _dayOffset = 0;

function getDayDateStr_(offset) {
  var d = new Date();
  d.setDate(d.getDate() + offset);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function changeDay(dir) {
  if (dir === 0) _dayOffset = 0;
  else _dayOffset += dir;
  loadDailySchedule();
}

function jumpToDay(dateStr) {
  if (!dateStr) return;
  var target = new Date(dateStr + 'T00:00:00');
  var now = new Date(); now.setHours(0, 0, 0, 0);
  _dayOffset = Math.round((target - now) / 86400000);
  loadDailySchedule();
}

function loadDailySchedule() {
  var dateStr = getDayDateStr_(_dayOffset);
  var orgFilter = document.getElementById('scheduleOrgFilter').value;
  document.getElementById('dayDatePicker').value = dateStr;

  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (!result.success) { showToast(result.message, 'error'); return; }
      renderDailyTimeline(result.data);
    })
    .withFailureHandler(function(err) { hideLoading(); showToast('일간 스케줄 로드 실패', 'error'); })
    .getDailySchedule(dateStr, orgFilter || null);
}

function renderDailyTimeline(data) {
  var dateStr = data.date;
  var employees = data.employees;
  var schedules = data.schedules;
  var leaves = data.leaves;

  // 제목
  var dt = new Date(dateStr + 'T00:00:00');
  var dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  document.getElementById('dayTitle').textContent =
    dt.getFullYear() + '년 ' + (dt.getMonth() + 1) + '월 ' + dt.getDate() + '일 (' + dayNames[dt.getDay()] + ')';

  // 타임라인: 6시~22시 (16시간, 각 1시간 단위)
  var startHour = 6, endHour = 22;
  var totalHours = endHour - startHour;

  // 헤더
  var html = '<div class="day-timeline">';
  html += '<div class="day-timeline-header">';
  html += '<div class="day-tl-emp-header">직원</div>';
  html += '<div class="day-tl-hours-header">';
  for (var h = startHour; h < endHour; h++) {
    var isWork = h >= 8 && h < 18;
    html += '<div class="day-tl-hour-mark' + (isWork ? ' work-hour' : '') + '">' +
      (h < 12 ? h + ':00' : (h === 12 ? '12:00' : (h - 12) + ':00')) +
      '<div class="day-tl-ampm">' + (h < 12 ? 'AM' : 'PM') + '</div></div>';
  }
  html += '</div></div>';

  // 직원 행
  for (var e = 0; e < employees.length; e++) {
    var emp = employees[e];
    var sched = schedules[emp.id];
    var leave = leaves[emp.id];
    var hours = sched ? sched.totalHours : 0;

    html += '<div class="day-timeline-row">';
    html += '<div class="day-tl-emp">' +
      '<div class="day-tl-emp-num">' + (emp.empNumber || '') + '</div>' +
      '<div><span class="day-tl-emp-name">' + emp.name + '</span>' +
      '<span class="day-tl-emp-hours">' + (hours > 0 ? hours + 'h' : '0m') + '</span></div>' +
      '</div>';

    html += '<div class="day-tl-bar-area">';

    if (leave) {
      // 휴가 칩 (시작 위치: 09:00 기준)
      var leaveLeft = ((9 - startHour) / totalHours) * 100;
      html += '<span class="day-tl-leave-chip" style="left:' + leaveLeft + '%;">' + leave + '</span>';
    } else if (sched) {
      // 스케줄 바
      var sStart = parseTimeToMin_(sched.startTime);
      var sEnd = parseTimeToMin_(sched.endTime);
      var barLeft = ((sStart / 60 - startHour) / totalHours) * 100;
      var barWidth = ((sEnd - sStart) / 60 / totalHours) * 100;
      if (barLeft < 0) barLeft = 0;
      if (barWidth > 100 - barLeft) barWidth = 100 - barLeft;

      var orgClass = 'org-' + emp.org;
      html += '<div class="day-tl-bar ' + orgClass + '" style="left:' + barLeft + '%;width:' + barWidth + '%;" ' +
        'onclick="onWeekCellClick(\'' + emp.id + '\',\'' + emp.name + '\',\'' + dateStr + '\')">' +
        '<span class="bar-time">' + sched.startTime + ' - ' + sched.endTime + '</span>' +
        '<span class="bar-org">' + emp.org + '</span></div>';
    }

    html += '</div></div>';
  }

  html += '</div>';
  document.getElementById('dayTimelineContainer').innerHTML = html;
}

function parseTimeToMin_(timeStr) {
  if (!timeStr) return 0;
  var p = timeStr.split(':');
  return (parseInt(p[0]) || 0) * 60 + (parseInt(p[1]) || 0);
}

// ============ 주간 뷰 (시프티 스타일) ============

var _weekOffset = 0; // 0 = 이번 주, -1 = 지난주, 1 = 다음주

function getWeekStartDate_(offset) {
  var d = new Date();
  var day = d.getDay(); // 0=일, 1=월...
  var diff = d.getDate() - day + (day === 0 ? -6 : 1); // 월요일로 이동
  d.setDate(diff + (offset * 7));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function changeWeek(dir) {
  if (dir === 0) _weekOffset = 0;
  else _weekOffset += dir;
  loadWeeklySchedule();
}

function jumpToWeek(dateStr) {
  if (!dateStr) return;
  var target = new Date(dateStr + 'T00:00:00');
  var now = new Date();
  // 이번 주 월요일 기준으로 offset 계산
  var nowMonday = new Date(now);
  nowMonday.setDate(nowMonday.getDate() - nowMonday.getDay() + (nowMonday.getDay() === 0 ? -6 : 1));
  nowMonday.setHours(0, 0, 0, 0);
  var targetMonday = new Date(target);
  targetMonday.setDate(targetMonday.getDate() - targetMonday.getDay() + (targetMonday.getDay() === 0 ? -6 : 1));
  targetMonday.setHours(0, 0, 0, 0);
  _weekOffset = Math.round((targetMonday - nowMonday) / (7 * 86400000));
  loadWeeklySchedule();
}

function loadWeeklySchedule() {
  var weekStart = getWeekStartDate_(_weekOffset);
  var orgFilter = document.getElementById('scheduleOrgFilter').value;

  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (!result.success) { showToast(result.message, 'error'); return; }
      renderWeeklyGrid(result.data);
    })
    .withFailureHandler(function(err) { hideLoading(); showToast('주간 스케줄 로드 실패', 'error'); })
    .getWeeklySchedule(weekStart, orgFilter || null);
}

var DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일'];
var KOREAN_HOLIDAYS_JS = {};
// 공휴일 룩업 (Code.gs KOREAN_HOLIDAYS와 동기화)
(function() {
  var hols = {
    2026: ['2026-01-01','2026-02-16','2026-02-17','2026-02-18','2026-03-01','2026-03-02',
           '2026-05-05','2026-05-24','2026-06-06','2026-08-15','2026-08-17',
           '2026-09-24','2026-09-25','2026-09-26','2026-10-03','2026-10-05','2026-10-09','2026-12-25']
  };
  for (var y in hols) { for (var i = 0; i < hols[y].length; i++) KOREAN_HOLIDAYS_JS[hols[y][i]] = true; }
})();

var _weekCollapsedOrgs = {}; // 접힌 조직 { orgName: true }

function renderWeeklyGrid(data) {
  var dates = data.dates;
  var employees = data.employees;
  var schedules = data.schedules;
  var leaves = data.leaves;

  // 제목
  var d0 = new Date(dates[0] + 'T00:00:00');
  var d6 = new Date(dates[6] + 'T00:00:00');
  var title = d0.getFullYear() + '년 ' + (d0.getMonth() + 1) + '월 ' + d0.getDate() + '일 - ' +
    d6.getDate() + '일';
  document.getElementById('weekTitle').textContent = title;
  // date picker 동기화
  var picker = document.getElementById('weekDatePicker');
  if (picker) picker.value = dates[0];

  var today = new Date();
  var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

  // 총 시간 계산
  var totalHours = 0;
  for (var k in schedules) { totalHours += schedules[k].totalHours || 0; }

  // 헤더
  var thead = '<tr><th></th>';
  for (var c = 0; c < 7; c++) {
    var dt = new Date(dates[c] + 'T00:00:00');
    var isToday = dates[c] === todayStr;
    var isSun = c === 6;
    var isSat = c === 5;
    var isHol = KOREAN_HOLIDAYS_JS[dates[c]];
    var cls = isToday ? 'today-col' : (isSun || isHol ? 'sun-col' : (isSat ? 'sat-col' : ''));
    var dayLabel = (dt.getMonth() + 1) + '/' + dt.getDate() + ' (' + DAY_NAMES[c] + ')';
    if (isHol) dayLabel += ' *';
    thead += '<th' + (cls ? ' class="' + cls + '"' : '') + '>' + dayLabel + '</th>';
  }
  thead += '</tr>';
  document.getElementById('weekGridHead').innerHTML = thead;

  // 총 시간 표시
  var thEl = document.getElementById('scheduleTotalHours');
  if (thEl) { thEl.textContent = '총 시간: ' + totalHours.toFixed(1) + 'h'; thEl.style.display = ''; }

  // 본문 (조직별 그룹핑 + 접기/펼치기)
  var html = '';
  var lastOrg = '';

  for (var e = 0; e < employees.length; e++) {
    var emp = employees[e];

    // 조직 구분선
    if (emp.org !== lastOrg) {
      lastOrg = emp.org;
      var cnt = countEmpInOrg_(employees, emp.org);
      var collapsed = _weekCollapsedOrgs[emp.org];
      var iconCls = collapsed ? ' collapsed' : '';
      html += '<tr class="org-divider" onclick="toggleWeekOrg(\'' + emp.org + '\')">' +
        '<td colspan="8"><span class="org-toggle-icon' + iconCls + '"><i class="fas fa-chevron-down"></i></span>' +
        emp.org + ' <span style="font-weight:400;color:var(--gray-500);">(' + cnt + '명)</span></td></tr>';
    }

    // 접힌 조직 직원 숨기기
    var rowStyle = _weekCollapsedOrgs[emp.org] ? ' style="display:none;"' : '';
    html += '<tr data-org="' + emp.org + '"' + rowStyle + '>';
    html += '<td><span class="week-emp-name">' + emp.name + '</span></td>';

    for (var d = 0; d < 7; d++) {
      var dateKey = emp.id + '|' + dates[d];
      var sched = schedules[dateKey];
      var leave = leaves[dateKey];
      var isHoliday = KOREAN_HOLIDAYS_JS[dates[d]];
      var isTodayCell = dates[d] === todayStr;
      var isWeekendCell = d >= 5;

      var tdCls = [];
      if (isTodayCell) tdCls.push('today-cell');
      if (!sched && !leave && !isHoliday) tdCls.push('empty-cell');
      var tdClsStr = tdCls.length ? ' class="' + tdCls.join(' ') + '"' : '';

      html += '<td' + tdClsStr + ' onclick="onWeekCellClick(\'' + emp.id + '\',\'' + emp.name + '\',\'' + dates[d] + '\')">';

      if (leave) {
        var lCls = (leave.type.indexOf('무단') >= 0 || leave.type.indexOf('병가') >= 0) ? ' red' : '';
        html += '<span class="week-leave-chip' + lCls + '">' + leave.type + '</span>';
      } else if (sched) {
        var cardCls = sched.publishStatus !== '게시' ? ' unpublished' : '';
        html += '<div class="week-sched-card' + cardCls + '">';
        html += '<div class="sched-time">' + sched.startTime + ' - ' + sched.endTime + '</div>';
        if (sched.template) html += '<div class="sched-tmpl">' + sched.template + '</div>';
        html += '</div>';
      } else if (isHoliday) {
        html += '<span style="font-size:10px;color:var(--gray-400);font-style:italic;">공휴일</span>';
      }

      html += '</td>';
    }
    html += '</tr>';
  }

  document.getElementById('weekGridBody').innerHTML = html;
}

function toggleWeekOrg(orgName) {
  _weekCollapsedOrgs[orgName] = !_weekCollapsedOrgs[orgName];
  var rows = document.querySelectorAll('#weekGridBody tr[data-org="' + orgName + '"]');
  for (var i = 0; i < rows.length; i++) {
    rows[i].style.display = _weekCollapsedOrgs[orgName] ? 'none' : '';
  }
  // 아이콘 회전
  var dividers = document.querySelectorAll('#weekGridBody .org-divider');
  for (var j = 0; j < dividers.length; j++) {
    var td = dividers[j].querySelector('td');
    if (td && td.textContent.indexOf(orgName) >= 0) {
      var icon = dividers[j].querySelector('.org-toggle-icon');
      if (icon) icon.classList.toggle('collapsed', _weekCollapsedOrgs[orgName]);
    }
  }
}

function countEmpInOrg_(employees, org) {
  var c = 0;
  for (var i = 0; i < employees.length; i++) if (employees[i].org === org) c++;
  return c;
}

function onWeekCellClick(empId, empName, dateStr) {
  // 근무일정 추가 모달 열기 (직원+날짜 프리셋)
  openAddScheduleModal();
  document.getElementById('schedFormDate').value = dateStr;
  var empSelect = document.getElementById('schedFormEmployee');
  if (empSelect) {
    for (var i = 0; i < empSelect.options.length; i++) {
      if (empSelect.options[i].value === empId) { empSelect.selectedIndex = i; break; }
    }
    if (typeof onScheduleEmployeeChange === 'function') onScheduleEmployeeChange();
  }
}

function initScheduleListDates_() {
  var start = document.getElementById('schedListStart');
  var end = document.getElementById('schedListEnd');
  if (!start.value) {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, '0');
    start.value = y + '-' + m + '-01';
    var lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    end.value = y + '-' + m + '-' + String(lastDay).padStart(2, '0');
  }
}

function loadSchedule() {
  var org = document.getElementById('scheduleOrgFilter').value;
  showLoading();

  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        _scheduleCache = result.data;
        var showLeave = document.getElementById('schedShowLeave').checked;
        renderCalendar(result.data, showLeave);
      }
    })
    .withFailureHandler(function(err) {
      hideLoading();
      showToast('서버 오류: ' + err.message, 'error');
    })
    .getSchedule(calendarYear, calendarMonth, org);
}

function loadScheduleList() {
  var startDate = document.getElementById('schedListStart').value;
  var endDate = document.getElementById('schedListEnd').value;
  var org = document.getElementById('scheduleOrgFilter').value;
  if (!startDate || !endDate) return;

  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        scheduleListData = result.data;
        scheduleListFiltered = scheduleListData.slice();
        scheduleListCurrentPage = 1;
        updateScheduleTotalHours_();
        renderScheduleList();
      }
    })
    .withFailureHandler(function(err) {
      hideLoading();
      showToast('서버 오류: ' + err.message, 'error');
    })
    .getScheduleList({ startDate: startDate, endDate: endDate, org: org || undefined });
}

function filterScheduleListLocal() {
  var keyword = document.getElementById('schedListSearch').value.toLowerCase();
  if (!keyword) {
    scheduleListFiltered = scheduleListData.slice();
  } else {
    scheduleListFiltered = scheduleListData.filter(function(s) {
      return (s.employeeName + s.org + s.template + s.note).toLowerCase().indexOf(keyword) !== -1;
    });
  }
  scheduleListCurrentPage = 1;
  updateScheduleTotalHours_();
  renderScheduleList();
}

function updateScheduleTotalHours_() {
  var total = 0;
  for (var i = 0; i < scheduleListFiltered.length; i++) {
    total += scheduleListFiltered[i].totalHours || 0;
  }
  var el = document.getElementById('scheduleTotalHours');
  el.style.display = scheduleView === 'list' ? '' : 'none';
  el.innerHTML = '<i class="fas fa-clock"></i> 총 시간 ' + total.toFixed(1) + 'h';
}

function renderScheduleList() {
  var start = (scheduleListCurrentPage - 1) * scheduleListPageSize;
  var page = scheduleListFiltered.slice(start, start + scheduleListPageSize);
  var totalPages = Math.max(1, Math.ceil(scheduleListFiltered.length / scheduleListPageSize));
  var dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  var showPublish = isManager();

  var html = '<table class="data-table"><thead><tr>';
  if (showPublish) html += '<th style="width:32px;"><input type="checkbox" onchange="toggleAllScheduleSelect(this)"></th>';
  html += '<th>사원번호</th><th>직원</th><th>날짜</th><th>일정시간</th>';
  html += '<th>조직</th><th>직무</th><th>템플릿</th><th>일정노트</th>';
  html += '<th>휴게시간</th><th>총 시간</th>';
  if (showPublish) html += '<th>게시상태</th>';
  html += '</tr></thead><tbody>';

  var colSpan = showPublish ? 12 : 10;
  if (page.length === 0) {
    html += '<tr><td colspan="' + colSpan + '" style="text-align:center;padding:40px;color:var(--gray-500);">일정이 없습니다.</td></tr>';
  }

  for (var i = 0; i < page.length; i++) {
    var s = page[i];
    var d = new Date(s.date.replace(/-/g, '/'));
    var dayStr = isNaN(d.getTime()) ? '' : '(' + dayNames[d.getDay()] + ')';
    var dateDisplay = s.date.substring(5).replace('-', '/') + ' ' + dayStr;
    var pubStatus = s.publishStatus || '미게시';

    html += '<tr>';
    if (showPublish) html += '<td onclick="event.stopPropagation();"><input type="checkbox" class="sched-select-cb" value="' + s.id + '"></td>';
    html += '<td onclick="openEditScheduleModal(\'' + s.id + '\')">' + s.employeeId + '</td>';
    html += '<td onclick="openEditScheduleModal(\'' + s.id + '\')"><strong>' + s.employeeName + '</strong></td>';
    html += '<td onclick="openEditScheduleModal(\'' + s.id + '\')">' + dateDisplay + '</td>';
    html += '<td onclick="openEditScheduleModal(\'' + s.id + '\')">' + s.startTime + ' - ' + s.endTime + '</td>';
    html += '<td onclick="openEditScheduleModal(\'' + s.id + '\')">' + s.org + '</td>';
    html += '<td onclick="openEditScheduleModal(\'' + s.id + '\')">' + s.duty + '</td>';
    html += '<td onclick="openEditScheduleModal(\'' + s.id + '\')">' + s.template + '</td>';
    html += '<td onclick="openEditScheduleModal(\'' + s.id + '\')">' + (s.note || '') + '</td>';
    html += '<td onclick="openEditScheduleModal(\'' + s.id + '\')">' + s.breakHours + '시간' + (s.autoBreak ? ' (자동)' : '') + '</td>';
    html += '<td onclick="openEditScheduleModal(\'' + s.id + '\')">' + s.totalHours + '시간</td>';
    if (showPublish) {
      var pubBadge = pubStatus === '게시'
        ? '<span class="status-badge" style="background:var(--success-light);color:var(--success);">게시</span>'
        : '<span class="status-badge" style="background:var(--gray-100);color:var(--gray-500);">미게시</span>';
      html += '<td>' + pubBadge + '</td>';
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  document.getElementById('scheduleListContainer').innerHTML = html;
  document.getElementById('schedListInfo').textContent =
    '총 ' + scheduleListFiltered.length + '건 중 ' + (start + 1) + '-' + Math.min(start + scheduleListPageSize, scheduleListFiltered.length);
  document.getElementById('schedListPageNum').textContent = scheduleListCurrentPage + ' / ' + totalPages;
}

function scheduleListPage(delta) {
  var totalPages = Math.max(1, Math.ceil(scheduleListFiltered.length / scheduleListPageSize));
  scheduleListCurrentPage += delta;
  if (scheduleListCurrentPage < 1) scheduleListCurrentPage = 1;
  if (scheduleListCurrentPage > totalPages) scheduleListCurrentPage = totalPages;
  renderScheduleList();
}

function changeCalendarMonth(delta) {
  if (delta === 0) {
    var now = new Date();
    calendarYear = now.getFullYear();
    calendarMonth = now.getMonth() + 1;
  } else {
    calendarMonth += delta;
    if (calendarMonth > 12) { calendarMonth = 1; calendarYear++; }
    if (calendarMonth < 1) { calendarMonth = 12; calendarYear--; }
  }
  loadSchedule();
}

function renderCalendar(data, showLeave) {
  document.getElementById('calendarTitle').textContent = data.year + '년 ' + data.month + '월';

  var firstDay = new Date(data.year, data.month - 1, 1).getDay();
  var lastDay = data.lastDay;
  var today = new Date();
  var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

  // 이벤트를 날짜별로 그룹핑
  var eventsByDate = {};
  for (var e = 0; e < data.events.length; e++) {
    var ev = data.events[e];
    if (!showLeave && ev.type === 'leave') continue;
    if (!eventsByDate[ev.date]) eventsByDate[ev.date] = [];
    eventsByDate[ev.date].push(ev);
  }

  var html = '';
  var dayHeaders = ['일', '월', '화', '수', '목', '금', '토'];
  for (var dh = 0; dh < 7; dh++) {
    html += '<div class="calendar-day-header">' + dayHeaders[dh] + '</div>';
  }

  // 이전 달 빈칸
  var prevMonthDays = new Date(data.year, data.month - 1, 0).getDate();
  for (var p = firstDay - 1; p >= 0; p--) {
    html += '<div class="calendar-cell other-month"><div class="day-num">' + (prevMonthDays - p) + '</div></div>';
  }

  // 현재 달
  for (var d = 1; d <= lastDay; d++) {
    var dateStr = data.year + '-' + String(data.month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    var dow = new Date(data.year, data.month - 1, d).getDay();
    var isHoliday = HOLIDAYS_2026.indexOf(dateStr) !== -1;
    var classes = 'calendar-cell';
    if (dateStr === todayStr) classes += ' today';
    if (dow === 0 || isHoliday) classes += ' sunday holiday';
    if (dow === 6) classes += ' saturday';

    html += '<div class="' + classes + '" onclick="openAddScheduleModal(\'' + dateStr + '\')">';
    html += '<div class="day-num">' + d + '</div>';

    var dayEvents = eventsByDate[dateStr] || [];
    var maxDisplay = 4;
    for (var de = 0; de < Math.min(dayEvents.length, maxDisplay); de++) {
      var evt = dayEvents[de];
      var evtClass = 'calendar-event ';
      var label = '';

      if (evt.type === 'leave') {
        evtClass += 'leave';
        label = '→ ' + evt.employeeName + ' | ' + evt.leaveType;
      } else if (evt.type === 'schedule') {
        evtClass += 'schedule';
        var unpublished = evt.publishStatus && evt.publishStatus !== '게시';
        var unpubStyle = unpublished ? 'opacity:0.5;border-style:dashed;' : '';
        label = evt.employeeName + '/' + evt.startTime + ',' + evt.totalHours + 'h';
        if (unpublished) label = '[미게시] ' + label;
        html += '<div class="' + evtClass + '" style="' + unpubStyle + '" title="' + evt.employeeName + ' ' + evt.startTime + '-' + evt.endTime + ' (' + evt.org + ')' + (unpublished ? ' [미게시]' : '') + '" onclick="event.stopPropagation();openEditScheduleModal(\'' + evt.id + '\')">';
        html += label + '</div>';
        continue;
      } else {
        if (evt.status === '지각') evtClass += 'late';
        else if (evt.status === '결근') evtClass += 'absent';
        else evtClass += 'attendance';
        label = evt.employeeName;
        if (evt.clockIn) label += ' ' + evt.clockIn;
      }

      html += '<div class="' + evtClass + '" title="' + label + '">' + label + '</div>';
    }
    if (dayEvents.length > maxDisplay) {
      html += '<div class="calendar-more" onclick="event.stopPropagation();toggleExpandDay(this, \'' + dateStr + '\')">' +
              (dayEvents.length - maxDisplay) + '개 더보기 ▼</div>';
    }

    html += '</div>';
  }

  // 다음 달 빈칸
  var totalCells = firstDay + lastDay;
  var remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (var n = 1; n <= remaining; n++) {
    html += '<div class="calendar-cell other-month"><div class="day-num">' + n + '</div></div>';
  }

  document.getElementById('calendarGrid').innerHTML = html;
}

function toggleExpandDay(el, dateStr) {
  if (!_scheduleCache) return;
  var showLeave = document.getElementById('schedShowLeave').checked;
  var dayEvents = _scheduleCache.events.filter(function(ev) {
    if (!showLeave && ev.type === 'leave') return false;
    return ev.date === dateStr;
  });

  var cell = el.parentElement;
  // 기존 이벤트와 더보기 제거 후 전체 렌더링
  var dayNum = cell.querySelector('.day-num').outerHTML;
  var html = dayNum;
  for (var i = 0; i < dayEvents.length; i++) {
    var evt = dayEvents[i];
    var evtClass = 'calendar-event ';
    var label = '';
    if (evt.type === 'leave') {
      evtClass += 'leave';
      label = '→ ' + evt.employeeName + ' | ' + evt.leaveType;
    } else if (evt.type === 'schedule') {
      evtClass += 'schedule';
      label = evt.employeeName + '/' + evt.startTime + ',' + evt.totalHours + 'h';
      html += '<div class="' + evtClass + '" title="' + evt.employeeName + ' ' + evt.startTime + '-' + evt.endTime + ' (' + evt.org + ')" onclick="event.stopPropagation();openEditScheduleModal(\'' + evt.id + '\')">' + label + '</div>';
      continue;
    } else {
      if (evt.status === '지각') evtClass += 'late';
      else if (evt.status === '결근') evtClass += 'absent';
      else evtClass += 'attendance';
      label = evt.employeeName + (evt.clockIn ? ' ' + evt.clockIn : '');
    }
    html += '<div class="' + evtClass + '" title="' + label + '">' + label + '</div>';
  }
  html += '<div class="calendar-more" onclick="event.stopPropagation();loadSchedule()">접기 ▲</div>';
  cell.innerHTML = html;
}

// ============ 근무일정 모달 ============
function openAddScheduleModal(dateStr) {
  document.getElementById('scheduleModalTitle').textContent = '근무일정 추가';
  document.getElementById('schedFormId').value = '';
  document.getElementById('schedFormDate').value = dateStr || new Date().toISOString().substring(0, 10);
  document.getElementById('schedFormEmployee').value = '';
  document.getElementById('schedFormOrg').value = '';
  document.getElementById('schedFormDuty').value = '경정청구팀';
  document.getElementById('schedFormTemplate').value = '일반근무';
  document.getElementById('schedFormStart').value = '09:00';
  document.getElementById('schedFormEnd').value = '18:00';
  document.getElementById('schedFormAutoBreak').checked = true;
  document.getElementById('schedFormBreakHours').value = 1;
  document.getElementById('schedFormBreakHours').disabled = false;
  document.getElementById('schedFormNote').value = '';
  document.getElementById('schedDeleteBtn').style.display = 'none';
  document.getElementById('schedFormCreatedAt').style.display = 'none';

  populateScheduleEmployeeDropdown_();
  document.getElementById('scheduleModal').classList.add('active');
}

function openEditScheduleModal(schedId) {
  // 캐시에서 검색
  var sched = null;
  if (_scheduleCache) {
    for (var i = 0; i < _scheduleCache.events.length; i++) {
      if (_scheduleCache.events[i].id === schedId) {
        sched = _scheduleCache.events[i];
        break;
      }
    }
  }
  // 목록뷰에서도 검색
  if (!sched) {
    for (var j = 0; j < scheduleListData.length; j++) {
      if (scheduleListData[j].id === schedId) {
        sched = scheduleListData[j];
        break;
      }
    }
  }

  if (!sched) {
    showToast('일정을 찾을 수 없습니다.', 'error');
    return;
  }

  var d = new Date(sched.date.replace(/-/g, '/'));
  var dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  var dayStr = isNaN(d.getTime()) ? '' : dayNames[d.getDay()];
  document.getElementById('scheduleModalTitle').textContent =
    (sched.employeeName || '') + '의 근무일정 바꾸기 (' + dayStr + ', ' + sched.date.substring(5) + ')';

  document.getElementById('schedFormId').value = sched.id;
  document.getElementById('schedFormDate').value = sched.date;
  document.getElementById('schedFormOrg').value = sched.org || '';
  document.getElementById('schedFormDuty').value = sched.duty || '경정청구팀';
  document.getElementById('schedFormStart').value = sched.startTime || '09:00';
  document.getElementById('schedFormEnd').value = sched.endTime || '18:00';
  document.getElementById('schedFormTemplate').value = sched.template || '일반근무';
  document.getElementById('schedFormAutoBreak').checked = sched.autoBreak !== false;
  document.getElementById('schedFormBreakHours').value = sched.breakHours !== undefined ? sched.breakHours : 1;
  document.getElementById('schedFormBreakHours').disabled = !(sched.autoBreak !== false);
  document.getElementById('schedFormNote').value = sched.note || '';

  populateScheduleEmployeeDropdown_();
  document.getElementById('schedFormEmployee').value = sched.employeeId || '';

  document.getElementById('schedDeleteBtn').style.display = '';
  if (sched.createdAt) {
    document.getElementById('schedFormCreatedAt').style.display = '';
    document.getElementById('schedFormCreatedAt').textContent = '생성일자: ' + sched.createdAt;
  }

  document.getElementById('scheduleModal').classList.add('active');
}

function closeScheduleModal() {
  document.getElementById('scheduleModal').classList.remove('active');
}

function populateScheduleEmployeeDropdown_() {
  var select = document.getElementById('schedFormEmployee');
  var current = select.value;
  select.innerHTML = '<option value="">선택하세요</option>';
  var emps = allEmployees || [];
  for (var i = 0; i < emps.length; i++) {
    if (emps[i].status !== '재직') continue;
    var opt = document.createElement('option');
    opt.value = emps[i].id;
    opt.textContent = emps[i].name + ' (' + emps[i].org + ')';
    opt.setAttribute('data-org', emps[i].org);
    opt.setAttribute('data-name', emps[i].name);
    select.appendChild(opt);
  }
  if (current) select.value = current;
}

function onScheduleEmployeeChange() {
  var select = document.getElementById('schedFormEmployee');
  var opt = select.options[select.selectedIndex];
  if (opt && opt.value) {
    document.getElementById('schedFormOrg').value = opt.getAttribute('data-org') || '';
    // 조직에 따라 템플릿 자동 변경
    var org = opt.getAttribute('data-org');
    if (org === '검토팀') {
      document.getElementById('schedFormTemplate').value = '조기근무';
      onScheduleTemplateChange();
    }
  }
}

function onScheduleTemplateChange() {
  var tmplName = document.getElementById('schedFormTemplate').value;
  // 템플릿 데이터에서 시간과 휴게시간 자동 반영
  var matched = null;
  if (allTemplates && allTemplates.length > 0) {
    for (var i = 0; i < allTemplates.length; i++) {
      if (allTemplates[i].name === tmplName) { matched = allTemplates[i]; break; }
    }
  }
  if (matched) {
    document.getElementById('schedFormStart').value = matched.startTime || '09:00';
    document.getElementById('schedFormEnd').value = matched.endTime || '18:00';
    document.getElementById('schedFormBreakHours').value = matched.breakHours !== undefined ? matched.breakHours : 1;
  } else if (tmplName === '조기근무') {
    document.getElementById('schedFormStart').value = '08:00';
    document.getElementById('schedFormEnd').value = '17:00';
    document.getElementById('schedFormBreakHours').value = 1;
  } else {
    document.getElementById('schedFormStart').value = '09:00';
    document.getElementById('schedFormEnd').value = '18:00';
    document.getElementById('schedFormBreakHours').value = 1;
  }
  document.getElementById('schedFormAutoBreak').checked = true;
}

function onAutoBreakChange() {
  var isAuto = document.getElementById('schedFormAutoBreak').checked;
  var breakInput = document.getElementById('schedFormBreakHours');
  breakInput.disabled = !isAuto;
  if (!isAuto) breakInput.value = 0;
  else if (Number(breakInput.value) === 0) breakInput.value = 1;
}

function saveSchedule() {
  var id = document.getElementById('schedFormId').value;
  var empSelect = document.getElementById('schedFormEmployee');
  var empOpt = empSelect.options[empSelect.selectedIndex];

  var data = {
    id: id || undefined,
    employeeId: empSelect.value,
    employeeName: empOpt && empOpt.value ? empOpt.getAttribute('data-name') : '',
    date: document.getElementById('schedFormDate').value,
    startTime: document.getElementById('schedFormStart').value,
    endTime: document.getElementById('schedFormEnd').value,
    org: document.getElementById('schedFormOrg').value,
    duty: document.getElementById('schedFormDuty').value,
    template: document.getElementById('schedFormTemplate').value,
    autoBreak: document.getElementById('schedFormAutoBreak').checked,
    breakHours: Number(document.getElementById('schedFormBreakHours').value) || 0,
    note: document.getElementById('schedFormNote').value
  };

  if (!data.employeeId || !data.date) {
    showToast('직원과 날짜는 필수입니다.', 'warning');
    return;
  }

  showLoading();
  var fnName = id ? 'updateSchedule' : 'addSchedule';

  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        showToast(result.message, 'success');
        closeScheduleModal();
        loadSchedule();
        if (scheduleView === 'list') loadScheduleList();
      } else {
        showToast(result.message, 'error');
      }
    })
    .withFailureHandler(function(err) {
      hideLoading();
      showToast('서버 오류: ' + err.message, 'error');
    })
    [fnName](data);
}

function deleteScheduleAction() {
  var id = document.getElementById('schedFormId').value;
  if (!id) return;
  if (!confirm('이 근무일정을 삭제하시겠습니까?')) return;

  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        showToast(result.message, 'success');
        closeScheduleModal();
        loadSchedule();
        if (scheduleView === 'list') loadScheduleList();
      } else {
        showToast(result.message, 'error');
      }
    })
    .withFailureHandler(function(err) {
      hideLoading();
      showToast('서버 오류: ' + err.message, 'error');
    })
    .deleteSchedule(id);
}

// ============ 휴가 관리 ============
var _leaveAllData = [];

var LEAVE_TYPE_DEFS = [
  { value: '연차', label: '연차', group: '연차휴가', hours: 8, deductDays: 1, multiDay: true },
  { value: '반차', label: '반차', group: '연차휴가', hours: 4, deductDays: 0.5, multiDay: false },
  { value: '반차(5h)', label: '반차(5시간)', group: '연차휴가', hours: 5, deductDays: 0.625, multiDay: false },
  { value: '반반차', label: '반반차', group: '연차휴가', hours: 2, deductDays: 0.25, multiDay: false },
  { value: '공휴일', label: '공휴일(유급)', group: '기타', hours: 8, deductDays: 0, multiDay: true },
  { value: '공휴일(3h)', label: '공휴일(유급3시간)', group: '기타', hours: 3, deductDays: 0, multiDay: false },
  { value: '공휴일(4h)', label: '공휴일(유급4시간)', group: '기타', hours: 4, deductDays: 0, multiDay: false },
  { value: '병가', label: '병가(증빙제출완료)', group: '기타', hours: 0, deductDays: 0, multiDay: true },
  { value: '경조사', label: '경조사(증빙제출완료)', group: '기타', hours: 0, deductDays: 0, multiDay: true },
  { value: '여성휴가', label: '여성휴가(무급)', group: '기타', hours: 0, deductDays: 0, multiDay: false },
  { value: '무급휴가', label: '무급휴가(대체근무)', group: '기타', hours: 8, deductDays: 1, multiDay: true },
  { value: '민방위', label: '민방위훈련(유급4h)', group: '기타', hours: 4, deductDays: 0, multiDay: false },
  { value: '예비군(5h)', label: '예비군 야간훈련(유급5h)', group: '기타', hours: 5, deductDays: 0, multiDay: false },
  { value: '예비군(6h)', label: '예비군 훈련(유급6h)', group: '기타', hours: 6, deductDays: 0, multiDay: false },
  { value: '예비군(8h)', label: '예비군 훈련(유급8h)', group: '기타', hours: 8, deductDays: 0, multiDay: false },
  { value: '무단결근', label: '무단결근', group: '기타', hours: 0, deductDays: 0, multiDay: true }
];

function getLeaveTypeDef(val) {
  for (var i = 0; i < LEAVE_TYPE_DEFS.length; i++) {
    if (LEAVE_TYPE_DEFS[i].value === val) return LEAVE_TYPE_DEFS[i];
  }
  return null;
}

function switchLeaveTab(tab) {
  currentLeaveTab = tab;
  var tabs = document.querySelectorAll('#leaveTabBar .tab-item');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.remove('active');
  }
  if (tab === 'my') tabs[0].classList.add('active');
  if (tab === 'pending') tabs[1].classList.add('active');
  if (tab === 'all') tabs[2].classList.add('active');

  // 필터바 표시 (전체 내역 탭에서만)
  document.getElementById('leaveFilterBar').style.display = (tab === 'all' && isManager()) ? 'flex' : 'none';

  loadLeaves();
}

function initLeaveFilters_() {
  var orgSel = document.getElementById('leaveFilterOrg');
  if (orgSel.options.length <= 1) {
    organizations.forEach(function(org) {
      orgSel.innerHTML += '<option value="' + org + '">' + org + '</option>';
    });
  }
  var startEl = document.getElementById('leaveFilterStart');
  if (!startEl.value) {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, '0');
    startEl.value = y + '-' + m + '-01';
    document.getElementById('leaveFilterEnd').value = y + '-' + m + '-' + String(new Date(y, now.getMonth() + 1, 0).getDate()).padStart(2, '0');
  }
}

function loadLeaves() {
  showLoading();
  var handler = function(result) {
    hideLoading();
    if (result.success) {
      _leaveAllData = result.data;
      filterLeavesLocal();
    } else {
      document.getElementById('leaveListContainer').innerHTML =
        '<div class="empty-state"><i class="fas fa-plane-departure"></i><p>' + (result.message || '') + '</p></div>';
    }
  };

  if (currentLeaveTab === 'my') {
    google.script.run.withSuccessHandler(handler).withFailureHandler(errHandler).getMyLeaves({});
  } else if (currentLeaveTab === 'pending') {
    google.script.run.withSuccessHandler(handler).withFailureHandler(errHandler).getLeaveList({ status: '대기' });
  } else {
    initLeaveFilters_();
    var filters = {};
    var startDate = document.getElementById('leaveFilterStart').value;
    var endDate = document.getElementById('leaveFilterEnd').value;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    var org = document.getElementById('leaveFilterOrg').value;
    if (org) filters.org = org;
    var type = document.getElementById('leaveFilterType').value;
    if (type) filters.leaveType = type;
    var status = document.getElementById('leaveFilterStatus').value;
    if (status) filters.status = status;
    google.script.run.withSuccessHandler(handler).withFailureHandler(errHandler).getLeaveList(filters);
  }
}

function filterLeavesLocal() {
  var q = '';
  if (currentLeaveTab === 'all') {
    q = (document.getElementById('leaveFilterKeyword').value || '').toLowerCase();
  }
  var filtered = _leaveAllData.filter(function(l) {
    if (!q) return true;
    return (l.employeeName || '').toLowerCase().indexOf(q) !== -1;
  });
  renderLeaveList(filtered);
}

function renderLeaveList(leaves) {
  var container = document.getElementById('leaveListContainer');
  if (leaves.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-plane-departure"></i><h3>휴가 내역 없음</h3></div>';
    return;
  }

  var showExtended = currentLeaveTab === 'all' && isManager();

  var html = '<div class="table-wrapper"><table><thead><tr>' +
    '<th>ID</th><th>이름</th><th>조직</th><th>유형</th><th>기간</th>';
  if (showExtended) {
    html += '<th>차감시간</th><th>차감일수</th>';
  } else {
    html += '<th>일수</th>';
  }
  html += '<th>사유</th><th>상태</th><th></th>' +
  '</tr></thead><tbody>';

  var totalDeductH = 0;
  var totalDeductD = 0;

  for (var i = 0; i < leaves.length; i++) {
    var l = leaves[i];
    var actions = '';

    if (l.approvalStatus === '대기') {
      if (isManager()) {
        actions = '<button class="btn btn-sm btn-success" onclick="handleApproveLeave(\'' + l.id + '\')"><i class="fas fa-check"></i></button> ' +
                  '<button class="btn btn-sm btn-danger" onclick="openRejectModal(\'' + l.id + '\')"><i class="fas fa-times"></i></button>';
      }
      actions += ' <button class="btn btn-sm btn-outline" onclick="handleCancelLeave(\'' + l.id + '\')">취소</button>';
    }

    // 유형 라벨
    var typeDef = getLeaveTypeDef(l.leaveType);
    var typeLabel = l.leaveType;
    if (typeDef) typeLabel = typeDef.label;

    totalDeductH += l.deductHours || 0;
    totalDeductD += l.deductDays || 0;

    var periodStr = l.startDate === l.endDate ? l.startDate : l.startDate + ' ~ ' + l.endDate;

    html += '<tr>' +
      '<td style="font-size:11px;color:var(--gray-500);">' + l.id + '</td>' +
      '<td><strong>' + l.employeeName + '</strong></td>' +
      '<td>' + (l.org || '-') + '</td>' +
      '<td>' + typeLabel + '</td>' +
      '<td style="font-size:12px;">' + periodStr + '</td>';
    if (showExtended) {
      html += '<td>' + (l.deductHours || 0) + 'h</td>';
      html += '<td>' + (l.deductDays || 0) + '일</td>';
    } else {
      html += '<td>' + l.days + '일</td>';
    }
    html += '<td style="font-size:12px;max-width:150px;overflow:hidden;text-overflow:ellipsis;">' + (l.reason || '-') + '</td>' +
      '<td><span class="status-badge ' + l.approvalStatus + '">' + l.approvalStatus + '</span>' +
        (l.rejectReason ? '<br><span style="font-size:11px;color:var(--danger);">' + l.rejectReason + '</span>' : '') +
      '</td>' +
      '<td style="white-space:nowrap;">' + actions + '</td>' +
    '</tr>';
  }

  html += '</tbody></table></div>';

  if (showExtended && leaves.length > 0) {
    html += '<div style="margin-top:8px;padding:8px 14px;background:var(--info-light);border-radius:20px;font-size:13px;display:inline-flex;gap:16px;">' +
      '<span>건수: <strong>' + leaves.length + '</strong></span>' +
      '<span>총 차감시간: <strong>' + totalDeductH + 'h</strong></span>' +
      '<span>총 차감일수: <strong>' + totalDeductD + '일</strong></span>' +
    '</div>';
  }

  container.innerHTML = html;
}

function openLeaveRequestModal() {
  var sel = document.getElementById('leaveFormType');
  sel.innerHTML = '<option value="">-- 선택 --</option>';
  sel.innerHTML += '<optgroup label="연차휴가">';
  LEAVE_TYPE_DEFS.filter(function(t) { return t.group === '연차휴가'; }).forEach(function(t) {
    sel.innerHTML += '<option value="' + t.value + '">' + t.label + ' (' + t.hours + 'h/' + t.deductDays + '일)</option>';
  });
  sel.innerHTML += '</optgroup><optgroup label="기타">';
  LEAVE_TYPE_DEFS.filter(function(t) { return t.group === '기타'; }).forEach(function(t) {
    sel.innerHTML += '<option value="' + t.value + '">' + t.label + '</option>';
  });
  sel.innerHTML += '</optgroup>';

  document.getElementById('leaveFormStart').value = '';
  document.getElementById('leaveFormEnd').value = '';
  document.getElementById('leaveFormReason').value = '';
  document.getElementById('leaveTypeInfo').textContent = '';
  document.getElementById('leaveDeductPreview').style.display = 'none';
  document.getElementById('leaveFormEndGroup').style.display = '';
  document.getElementById('leaveModal').classList.add('active');
}

function onLeaveTypeChange() {
  var typeVal = document.getElementById('leaveFormType').value;
  var typeDef = getLeaveTypeDef(typeVal);
  var endGroup = document.getElementById('leaveFormEndGroup');
  var infoEl = document.getElementById('leaveTypeInfo');
  var previewEl = document.getElementById('leaveDeductPreview');

  if (!typeDef) {
    infoEl.textContent = '';
    previewEl.style.display = 'none';
    endGroup.style.display = '';
    return;
  }

  // 단일일 타입이면 종료일 자동 맞춤
  if (!typeDef.multiDay) {
    endGroup.style.display = 'none';
    var startDate = document.getElementById('leaveFormStart').value;
    if (startDate) document.getElementById('leaveFormEnd').value = startDate;
    infoEl.textContent = typeDef.label + ': ' + typeDef.hours + '시간, ' + typeDef.deductDays + '일 차감 (하루만 선택)';
  } else {
    endGroup.style.display = '';
    infoEl.textContent = typeDef.label + ': ' + typeDef.hours + '시간/일, ' + typeDef.deductDays + '일/일 차감';
  }

  // 차감 미리보기
  var start = document.getElementById('leaveFormStart').value;
  var end = document.getElementById('leaveFormEnd').value || start;
  if (start && end && typeDef.deductDays > 0) {
    var workDays = countWorkDays_(start, end);
    var totalDeduct = workDays * typeDef.deductDays;
    document.getElementById('leaveDeductLabel').textContent = totalDeduct + '일 (연차 차감)';
    previewEl.style.display = '';
  } else {
    previewEl.style.display = 'none';
  }
}

function countWorkDays_(startStr, endStr) {
  var start = new Date(startStr);
  var end = new Date(endStr);
  var days = 0;
  for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    var dow = d.getDay();
    if (dow !== 0 && dow !== 6) days++;
  }
  return days;
}

function closeLeaveModal() {
  document.getElementById('leaveModal').classList.remove('active');
}

function submitLeaveForm() {
  var typeVal = document.getElementById('leaveFormType').value;
  var typeDef = getLeaveTypeDef(typeVal);
  var startDate = document.getElementById('leaveFormStart').value;
  var endDate = document.getElementById('leaveFormEnd').value;

  // 단일일 타입이면 종료일 = 시작일
  if (typeDef && !typeDef.multiDay) {
    endDate = startDate;
  }

  var formData = {
    leaveType: typeVal,
    startDate: startDate,
    endDate: endDate,
    reason: document.getElementById('leaveFormReason').value.trim()
  };

  if (!formData.leaveType) { showToast('휴가 유형을 선택해주세요.', 'warning'); return; }
  if (!formData.startDate) { showToast('시작일을 입력해주세요.', 'warning'); return; }
  if (!formData.endDate) { showToast('종료일을 입력해주세요.', 'warning'); return; }

  document.getElementById('leaveFormSubmitBtn').disabled = true;
  showLoading();

  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      document.getElementById('leaveFormSubmitBtn').disabled = false;
      if (result.success) {
        closeLeaveModal();
        loadLeaves();
        showToast(result.message, 'success');
      } else {
        showToast(result.message, 'error');
      }
    })
    .withFailureHandler(function(err) {
      hideLoading();
      document.getElementById('leaveFormSubmitBtn').disabled = false;
      showToast('서버 오류: ' + err.message, 'error');
    })
    .requestLeave(formData);
}

function handleApproveLeave(leaveId) {
  if (!confirm('이 휴가를 승인하시겠습니까?')) return;
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        pendingLeavesCount = Math.max(0, pendingLeavesCount - 1);
        updateLeaveBadge();
        loadLeaves();
        showToast(result.message, 'success');
      } else {
        showToast(result.message, 'error');
      }
    })
    .withFailureHandler(errHandler)
    .approveLeave(leaveId);
}

function openRejectModal(leaveId) {
  document.getElementById('rejectLeaveId').value = leaveId;
  document.getElementById('rejectReason').value = '';
  document.getElementById('rejectModal').classList.add('active');
}

function closeRejectModal() {
  document.getElementById('rejectModal').classList.remove('active');
}

function submitRejectLeave() {
  var leaveId = document.getElementById('rejectLeaveId').value;
  var reason = document.getElementById('rejectReason').value.trim();
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        closeRejectModal();
        pendingLeavesCount = Math.max(0, pendingLeavesCount - 1);
        updateLeaveBadge();
        loadLeaves();
        showToast(result.message, 'success');
      } else {
        showToast(result.message, 'error');
      }
    })
    .withFailureHandler(errHandler)
    .rejectLeave(leaveId, reason);
}

function handleCancelLeave(leaveId) {
  if (!confirm('이 휴가 신청을 취소하시겠습니까?')) return;
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        loadLeaves();
        showToast(result.message, 'success');
      } else {
        showToast(result.message, 'error');
      }
    })
    .withFailureHandler(errHandler)
    .cancelLeave(leaveId);
}

function openLeaveManageModal() {
  var sel = document.getElementById('leaveManageEmpSelect');
  sel.innerHTML = '<option value="">-- 직원 선택 --</option>';
  for (var i = 0; i < allEmployees.length; i++) {
    var e = allEmployees[i];
    if (e.status !== '재직') continue;
    sel.innerHTML += '<option value="' + e.id + '" data-name="' + e.name + '" data-org="' + (e.org || '') + '">' + e.name + ' (' + (e.org || '-') + ')</option>';
  }

  var now = new Date();
  document.getElementById('lmAdjustExpiry').value = now.getFullYear() + '-12-31';
  document.getElementById('lmAdjustDays').value = '1';
  document.getElementById('lmAdjustMemo').value = '';
  document.getElementById('leaveManageBalanceArea').style.display = 'none';
  document.getElementById('leaveManageModal').classList.add('active');
}

function closeLeaveManageModal() {
  document.getElementById('leaveManageModal').classList.remove('active');
}

function loadLeaveManageBalance() {
  var empId = document.getElementById('leaveManageEmpSelect').value;
  var area = document.getElementById('leaveManageBalanceArea');
  if (!empId) { area.style.display = 'none'; return; }

  area.style.display = '';
  document.getElementById('lmTotalDays').textContent = '...';
  document.getElementById('lmUsedDays').textContent = '...';
  document.getElementById('lmRemainDays').textContent = '...';

  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success && result.data) {
        var d = result.data;
        document.getElementById('lmTotalDays').textContent = d.totalDays;
        document.getElementById('lmUsedDays').textContent = d.usedDays;
        document.getElementById('lmRemainDays').textContent = d.remainDays;
      } else {
        document.getElementById('lmTotalDays').textContent = '0';
        document.getElementById('lmUsedDays').textContent = '0';
        document.getElementById('lmRemainDays').textContent = '0';
      }
    })
    .withFailureHandler(function(err) {
      showToast('조회 실패: ' + err.message, 'error');
    })
    .getEmployeeLeaveBalance(empId);
}

function submitLeaveAdjust() {
  var empId = document.getElementById('leaveManageEmpSelect').value;
  if (!empId) { showToast('직원을 선택해주세요.', 'warning'); return; }

  var sel = document.getElementById('leaveManageEmpSelect');
  var opt = sel.options[sel.selectedIndex];
  var empName = opt.getAttribute('data-name') || '';
  var empOrg = opt.getAttribute('data-org') || '';

  var days = parseFloat(document.getElementById('lmAdjustDays').value);
  if (!days || days === 0) { showToast('조정 일수를 입력해주세요.', 'warning'); return; }

  var memo = document.getElementById('lmAdjustMemo').value || '관리자 수동 조정';
  var expiry = document.getElementById('lmAdjustExpiry').value;
  var now = new Date();
  var todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        showToast(result.message, 'success');
        loadLeaveManageBalance();
      } else {
        showToast(result.message, 'error');
      }
    })
    .withFailureHandler(errHandler)
    .addLeaveAccrual({
      employeeId: empId,
      employeeName: empName,
      org: empOrg,
      duty: '경정청구팀',
      leaveGroup: '연차휴가',
      accrualDays: days,
      accrualDate: todayStr,
      expiryDate: expiry || (now.getFullYear() + '-12-31'),
      accrualType: '수동',
      memo: memo
    });
}

function syncEmployeeLeave() {
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        showToast(result.message, 'success');
        loadLeaveManageBalance();
      } else {
        showToast(result.message, 'error');
      }
    })
    .withFailureHandler(errHandler)
    .syncLeaveUsedDays();
}

// ============ 휴가 발생 ============
var _accrualView = 'employee';
var _accrualData = [];
var _accrualSummary = [];

function initAccrualPage() {
  // 관리자 버튼 표시
  if (isManager()) {
    document.getElementById('accrualAddBtn').style.display = '';
  }
  if (isSuperAdmin()) {
    document.getElementById('accrualGenBtn').style.display = '';
    document.getElementById('accrualSyncBtn').style.display = '';
  }

  // 기간 기본값
  var startEl = document.getElementById('accrualStartDate');
  var endEl = document.getElementById('accrualEndDate');
  if (!startEl.value) {
    var now = new Date();
    var y = now.getFullYear();
    startEl.value = y + '-01-01';
    endEl.value = y + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }

  // 조직 필터 채우기
  var orgSel = document.getElementById('accrualFilterOrg');
  if (orgSel.options.length <= 1) {
    organizations.forEach(function(org) {
      orgSel.innerHTML += '<option value="' + org + '">' + org + '</option>';
    });
  }

  loadAccrualData();
}

function switchAccrualView(view) {
  _accrualView = view;
  var tabs = document.querySelectorAll('#accrualTabBar .tab-item');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
  if (view === 'employee') tabs[0].classList.add('active');
  else tabs[1].classList.add('active');
  loadAccrualData();
}

function loadAccrualData() {
  showLoading();
  var filters = {};
  var org = document.getElementById('accrualFilterOrg').value;
  if (org) filters.org = org;
  var activeOnly = document.getElementById('accrualActiveOnly').checked;
  if (activeOnly) filters.activeOnly = true;
  var startDate = document.getElementById('accrualStartDate').value;
  var endDate = document.getElementById('accrualEndDate').value;
  if (startDate) filters.startDate = startDate;
  if (endDate) filters.endDate = endDate;
  filters.baseDate = endDate || startDate;

  if (_accrualView === 'employee') {
    google.script.run
      .withSuccessHandler(function(result) {
        hideLoading();
        if (result.success) {
          _accrualSummary = result.data;
          renderAccrualEmployeeView(_accrualSummary);
        } else {
          document.getElementById('accrualContainer').innerHTML =
            '<div class="empty-state"><i class="fas fa-seedling"></i><p>' + (result.message || '') + '</p></div>';
        }
      })
      .withFailureHandler(errHandler)
      .getLeaveAccrualSummary(filters);
  } else {
    if (!filters.startDate) filters.startDate = new Date().getFullYear() + '-01-01';
    if (!filters.endDate) filters.endDate = new Date().getFullYear() + '-12-31';
    google.script.run
      .withSuccessHandler(function(result) {
        hideLoading();
        if (result.success) {
          _accrualData = result.data;
          renderAccrualListView(_accrualData);
        } else {
          document.getElementById('accrualContainer').innerHTML =
            '<div class="empty-state"><i class="fas fa-seedling"></i><p>' + (result.message || '') + '</p></div>';
        }
      })
      .withFailureHandler(errHandler)
      .getLeaveAccrualList(filters);
  }
}

function renderAccrualEmployeeView(data) {
  var container = document.getElementById('accrualContainer');
  if (data.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-seedling"></i><h3>휴가 발생 내역 없음</h3>' +
      '<p>직원의 입사일 기준으로 근로기준법에 따라 연차를 자동 발생시킵니다.</p>' +
      '<p style="font-size:12px;color:var(--gray-500);">상단의 <strong>규칙 기반 발생</strong> 버튼을 클릭하면 모든 재직 직원에 대해 자동 계산됩니다.<br>발생 후 <strong>사용일수 동기화</strong>로 실제 휴가 사용분을 반영할 수 있습니다.</p></div>';
    return;
  }

  var totalDays = 0, totalUsed = 0, totalRemain = 0;

  var html = '<div class="table-wrapper"><table><thead><tr>' +
    '<th>직원</th><th>입사일</th><th>조직</th><th>휴가 그룹</th><th>산정 기간</th>' +
    '<th style="text-align:right;">총 휴가</th><th style="text-align:right;">사용</th><th style="text-align:right;">남은</th>' +
    '</tr></thead><tbody>';

  for (var i = 0; i < data.length; i++) {
    var s = data[i];
    totalDays += s.totalDays;
    totalUsed += s.usedDays;
    totalRemain += s.remainDays;

    var remainClass = '';
    if (s.remainDays === 0 && s.totalDays > 0) remainClass = ' style="color:var(--danger);font-weight:700;"';
    else if (s.remainDays <= 2 && s.totalDays > 0) remainClass = ' style="color:var(--warning);font-weight:600;"';

    html += '<tr style="cursor:pointer;" onclick="openAccrualDetailModal(\'' + s.employeeId + '\',\'' + s.employeeName + '\')">' +
      '<td><strong>' + s.employeeName + '</strong></td>' +
      '<td style="font-size:12px;">' + (s.joinDate || '-') + '</td>' +
      '<td>' + (s.org || '-') + '</td>' +
      '<td><span style="background:var(--info-light);color:var(--info);padding:2px 8px;border-radius:10px;font-size:12px;">' + (s.leaveGroup || '연차휴가') + '</span></td>' +
      '<td style="font-size:12px;color:var(--gray-600);">' + (s.accrualPeriod || '-') + '</td>' +
      '<td style="text-align:right;font-weight:600;">' + s.totalDays + '일</td>' +
      '<td style="text-align:right;">' + s.usedDays + '일</td>' +
      '<td style="text-align:right;"' + remainClass + '>' + s.remainDays + '일</td>' +
    '</tr>';
  }

  html += '</tbody></table></div>';

  // 요약바
  var usageRate = totalDays > 0 ? Math.round(totalUsed / totalDays * 100 * 10) / 10 : 0;
  html += '<div style="margin-top:10px;padding:8px 16px;background:var(--info-light);border-radius:20px;font-size:13px;display:inline-flex;gap:18px;flex-wrap:wrap;">' +
    '<span>직원: <strong>' + data.length + '명</strong></span>' +
    '<span>총 발생: <strong>' + totalDays + '일</strong></span>' +
    '<span>사용: <strong>' + totalUsed + '일</strong></span>' +
    '<span>잔여: <strong>' + totalRemain + '일</strong></span>' +
    '<span>사용률: <strong>' + usageRate + '%</strong></span>' +
  '</div>';

  container.innerHTML = html;
}

function renderAccrualListView(data) {
  var container = document.getElementById('accrualContainer');
  if (data.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-seedling"></i><h3>휴가 발생 내역 없음</h3></div>';
    return;
  }

  var html = '<div class="table-wrapper"><table><thead><tr>' +
    '<th>직원</th><th>입사일</th><th>조직</th><th>직무</th><th>휴가 그룹</th>' +
    '<th>발생 시점</th><th>만료 시점</th><th style="text-align:right;">발생 일수</th><th style="text-align:right;">사용 일수</th>';

  if (isManager()) html += '<th></th>';
  html += '</tr></thead><tbody>';

  var totalAccrued = 0, totalUsed = 0;

  for (var i = 0; i < data.length; i++) {
    var a = data[i];
    totalAccrued += a.accrualDays;
    totalUsed += a.usedDays;

    // 만료 경고
    var expiryClass = '';
    if (a.expiryDate) {
      var today = new Date();
      var expiry = new Date(a.expiryDate);
      var daysToExpiry = Math.ceil((expiry - today) / 86400000);
      if (daysToExpiry < 0) expiryClass = ' style="color:var(--danger);text-decoration:line-through;"';
      else if (daysToExpiry <= 30) expiryClass = ' style="color:var(--warning);"';
    }

    html += '<tr>' +
      '<td><strong>' + a.employeeName + '</strong></td>' +
      '<td style="font-size:12px;">' + getEmpJoinDate_(a.employeeId) + '</td>' +
      '<td>' + (a.org || '-') + '</td>' +
      '<td style="font-size:12px;">' + (a.duty || '-') + '</td>' +
      '<td><span style="background:var(--info-light);color:var(--info);padding:2px 8px;border-radius:10px;font-size:12px;">' + (a.leaveGroup || '-') + '</span></td>' +
      '<td style="font-size:12px;">' + (a.accrualDate || '-') + '</td>' +
      '<td style="font-size:12px;"' + expiryClass + '>' + (a.expiryDate || '-') + '</td>' +
      '<td style="text-align:right;font-weight:600;">' + a.accrualDays + '일</td>' +
      '<td style="text-align:right;">' + a.usedDays + '일</td>';

    if (isManager()) {
      html += '<td style="white-space:nowrap;">' +
        '<button class="btn btn-sm btn-outline" onclick="openEditAccrualModal(\'' + a.id + '\')"><i class="fas fa-edit"></i></button>' +
      '</td>';
    }
    html += '</tr>';
  }

  html += '</tbody></table></div>';

  html += '<div style="margin-top:10px;padding:8px 16px;background:var(--info-light);border-radius:20px;font-size:13px;display:inline-flex;gap:18px;flex-wrap:wrap;">' +
    '<span>건수: <strong>' + data.length + '</strong></span>' +
    '<span>총 발생: <strong>' + totalAccrued + '일</strong></span>' +
    '<span>총 사용: <strong>' + totalUsed + '일</strong></span>' +
  '</div>';

  container.innerHTML = html;
}

function getEmpJoinDate_(empId) {
  for (var i = 0; i < allEmployees.length; i++) {
    if (allEmployees[i].id === empId) return allEmployees[i].joinDate || '-';
  }
  return '-';
}

function openAccrualDetailModal(empId, empName) {
  if (!isManager()) return;
  // 직원의 개별 발생 건 조회
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success && result.data.length > 0) {
        _accrualData = result.data;
        // 목록 뷰로 전환하여 해당 직원 건만 표시
        _accrualView = 'list';
        var tabs = document.querySelectorAll('#accrualTabBar .tab-item');
        tabs[0].classList.remove('active');
        tabs[1].classList.add('active');
        renderAccrualListView(result.data);
      } else {
        showToast(empName + '의 발생 내역이 없습니다.', 'info');
      }
    })
    .withFailureHandler(errHandler)
    .getLeaveAccrualList({ employeeId: empId });
}

function openAccrualModal() {
  document.getElementById('accrualEditId').value = '';
  document.getElementById('accrualModalTitle').textContent = '휴가 수동 발생';
  document.getElementById('accrualSaveLabel').textContent = '발생하기';
  document.getElementById('accrualDeleteBtn').style.display = 'none';
  document.getElementById('accrualUsedGroup').style.display = 'none';

  // 직원 드롭다운
  var sel = document.getElementById('accrualFormEmp');
  sel.innerHTML = '<option value="">-- 직원 선택 --</option>';
  var active = allEmployees.filter(function(e) { return e.status === '재직'; });
  active.sort(function(a, b) { return a.name > b.name ? 1 : -1; });
  for (var i = 0; i < active.length; i++) {
    sel.innerHTML += '<option value="' + active[i].id + '">' + active[i].name + ' (' + active[i].org + ')</option>';
  }

  document.getElementById('accrualFormGroup').value = '연차휴가';
  document.getElementById('accrualFormDays').value = '1';
  document.getElementById('accrualFormUsed').value = '0';
  document.getElementById('accrualFormStart').value = '';
  document.getElementById('accrualFormExpiry').value = '';
  document.getElementById('accrualFormMemo').value = '';
  document.getElementById('accrualModal').classList.add('active');
}

function openEditAccrualModal(accrualId) {
  var acc = null;
  for (var i = 0; i < _accrualData.length; i++) {
    if (_accrualData[i].id === accrualId) { acc = _accrualData[i]; break; }
  }
  if (!acc) { showToast('발생 건을 찾을 수 없습니다.', 'error'); return; }

  document.getElementById('accrualEditId').value = acc.id;
  document.getElementById('accrualModalTitle').textContent = '휴가 발생 수정';
  document.getElementById('accrualSaveLabel').textContent = '수정하기';
  document.getElementById('accrualDeleteBtn').style.display = '';
  document.getElementById('accrualUsedGroup').style.display = '';

  // 직원 드롭다운 (수정 시 선택 고정)
  var sel = document.getElementById('accrualFormEmp');
  sel.innerHTML = '<option value="' + acc.employeeId + '">' + acc.employeeName + ' (' + acc.org + ')</option>';
  sel.disabled = true;

  document.getElementById('accrualFormGroup').value = acc.leaveGroup || '연차휴가';
  document.getElementById('accrualFormDays').value = acc.accrualDays;
  document.getElementById('accrualFormUsed').value = acc.usedDays;
  document.getElementById('accrualFormStart').value = acc.accrualDate;
  document.getElementById('accrualFormExpiry').value = acc.expiryDate;
  document.getElementById('accrualFormMemo').value = acc.memo || '';
  document.getElementById('accrualModal').classList.add('active');
}

function closeAccrualModal() {
  document.getElementById('accrualModal').classList.remove('active');
  document.getElementById('accrualFormEmp').disabled = false;
}

function saveAccrual() {
  var editId = document.getElementById('accrualEditId').value;
  var empId = document.getElementById('accrualFormEmp').value;
  var group = document.getElementById('accrualFormGroup').value;
  var days = document.getElementById('accrualFormDays').value;
  var start = document.getElementById('accrualFormStart').value;
  var expiry = document.getElementById('accrualFormExpiry').value;
  var memo = document.getElementById('accrualFormMemo').value;

  if (!editId && !empId) { showToast('직원을 선택해주세요.', 'warning'); return; }
  if (!start) { showToast('발생 시점을 입력해주세요.', 'warning'); return; }
  if (!expiry) { showToast('만료 시점을 입력해주세요.', 'warning'); return; }
  if (!days || Number(days) <= 0) { showToast('발생 일수를 입력해주세요.', 'warning'); return; }

  showLoading();

  if (editId) {
    var updateData = {
      leaveGroup: group,
      accrualDate: start,
      expiryDate: expiry,
      accrualDays: days,
      usedDays: document.getElementById('accrualFormUsed').value,
      memo: memo
    };
    google.script.run
      .withSuccessHandler(function(result) {
        hideLoading();
        if (result.success) {
          closeAccrualModal();
          loadAccrualData();
          showToast(result.message, 'success');
        } else {
          showToast(result.message, 'error');
        }
      })
      .withFailureHandler(errHandler)
      .updateLeaveAccrual(editId, updateData);
  } else {
    var addData = {
      employeeId: empId,
      leaveGroup: group,
      accrualDays: days,
      accrualDate: start,
      expiryDate: expiry,
      memo: memo
    };
    google.script.run
      .withSuccessHandler(function(result) {
        hideLoading();
        if (result.success) {
          closeAccrualModal();
          loadAccrualData();
          showToast(result.message, 'success');
        } else {
          showToast(result.message, 'error');
        }
      })
      .withFailureHandler(errHandler)
      .addLeaveAccrual(addData);
  }
}

function deleteAccrual() {
  var id = document.getElementById('accrualEditId').value;
  if (!id) return;
  if (!confirm('이 발생 건을 삭제하시겠습니까?')) return;

  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        closeAccrualModal();
        loadAccrualData();
        showToast(result.message, 'success');
      } else {
        showToast(result.message, 'error');
      }
    })
    .withFailureHandler(errHandler)
    .deleteLeaveAccrual(id);
}

function generateAccruals() {
  if (!confirm('재직 중인 모든 직원에 대해 근로기준법 기준으로 연차를 자동 발생시킵니다.\n이미 등록된 건은 중복 생성되지 않습니다.\n\n진행하시겠습니까?')) return;

  var baseDate = document.getElementById('accrualEndDate').value;
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        loadAccrualData();
        showToast(result.message, 'success');
      } else {
        showToast(result.message, 'error');
      }
    })
    .withFailureHandler(errHandler)
    .generateLeaveAccruals(baseDate);
}

function syncUsedDays() {
  if (!confirm('휴가 시트의 승인된 휴가 기록을 기준으로\n휴가발생 시트의 사용일수를 업데이트합니다.\n\n진행하시겠습니까?')) return;
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        loadAccrualData();
        showToast(result.message, 'success');
      } else {
        showToast(result.message, 'error');
      }
    })
    .withFailureHandler(errHandler)
    .syncLeaveUsedDays();
}

// ============ 급여 ============
function switchPayrollTab(tab) {
  if (tab === 'manage' && !canPayrollAdmin) return;
  if (tab === 'closing' && !canPayrollAdmin) return;
  currentPayrollTab = tab;
  var tabs = document.querySelectorAll('#payrollTabBar .tab-item');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.remove('active');
  }
  if (tab === 'my') tabs[0].classList.add('active');
  if (tab === 'manage') tabs[1].classList.add('active');
  if (tab === 'closing') tabs[2].classList.add('active');

  if (tab === 'closing') {
    loadClosingList();
  } else {
    loadPayroll();
  }
}

function loadPayroll() {
  var actionsEl = document.getElementById('payrollActions');
  if (currentPayrollTab === 'manage' && canPayrollAdmin) {
    actionsEl.innerHTML =
      '<button class="btn btn-outline btn-sm" onclick="openManualAttModal()"><i class="fas fa-plus"></i> 수동 출퇴근</button> ' +
      '<button class="btn btn-primary" onclick="openPayrollCalcModal()"><i class="fas fa-calculator"></i> 급여 계산</button>';
  } else {
    actionsEl.innerHTML = '';
  }

  // 확정/확정취소 버튼은 테이블 위에 별도로 렌더링


  showLoading();
  if (currentPayrollTab === 'my') {
    google.script.run
      .withSuccessHandler(function(result) {
        hideLoading();
        if (result.success) { renderMyPayroll(result.data); }
        else { document.getElementById('payrollContainer').innerHTML = '<div class="empty-state"><i class="fas fa-won-sign"></i><p>' + (result.message || '') + '</p></div>'; }
      })
      .withFailureHandler(errHandler)
      .getMyPayroll({});
  } else {
    google.script.run
      .withSuccessHandler(function(result) {
        hideLoading();
        if (result.success) { renderPayrollManage(result.data); }
        else { document.getElementById('payrollContainer').innerHTML = '<div class="empty-state"><i class="fas fa-won-sign"></i><p>' + (result.message || '') + '</p></div>'; }
      })
      .withFailureHandler(errHandler)
      .getPayrollList({});
  }
}

function renderMyPayroll(payrolls) {
  var container = document.getElementById('payrollContainer');
  if (payrolls.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-won-sign"></i><h3>급여 내역 없음</h3></div>';
    return;
  }

  var html = '';
  for (var i = 0; i < payrolls.length; i++) {
    var p = payrolls[i];
    html += '<div class="payslip">' +
      '<div class="payslip-header">' +
        '<div><strong style="font-size:16px;">' + p.period + ' 급여명세서</strong></div>' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<span class="status-badge ' + p.status + '">' + p.status + '</span>' +
          '<button class="btn btn-sm btn-outline" onclick="viewPayslip(\'' + p.id + '\')" style="font-size:11px;"><i class="fas fa-file-alt"></i> 상세</button>' +
        '</div>' +
      '</div>' +
      '<div class="payslip-row"><span>근무일수</span><span>' + p.totalDays + '일 (' + p.totalHours.toFixed(1) + '시간)</span></div>' +
      '<div class="payslip-row"><span>기본급여 (시급 x 근무시간)</span><span>' + formatNumber(p.basePay) + '원</span></div>' +
      '<div class="payslip-row"><span>연장근로수당</span><span>' + formatNumber(p.overtimePay) + '원</span></div>' +
      '<div class="payslip-row"><span>야간근로수당</span><span>' + formatNumber(p.nightPay) + '원</span></div>' +
      '<div class="payslip-row"><span>휴일근로수당</span><span>' + formatNumber(p.holidayPay) + '원</span></div>' +
      '<div class="payslip-row"><span>주휴수당</span><span>' + formatNumber(p.weeklyHolidayPay) + '원</span></div>' +
      '<div class="payslip-row total"><span>총 지급액</span><span style="color:var(--primary);">' + formatNumber(p.totalPay) + '원</span></div>' +
    '</div>';
  }
  container.innerHTML = html;
}

function renderPayrollManage(payrolls) {
  var container = document.getElementById('payrollContainer');
  if (payrolls.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-won-sign"></i><h3>급여 내역 없음</h3><p>급여 계산 버튼을 눌러 정산하세요.</p></div>';
    return;
  }

  // 기간별 그룹 요약
  var periodGroups = {};
  for (var g = 0; g < payrolls.length; g++) {
    var pr = payrolls[g];
    if (!periodGroups[pr.period]) {
      periodGroups[pr.period] = { total: 0, confirmed: 0, temp: 0, totalPay: 0, netPay: 0 };
    }
    periodGroups[pr.period].total++;
    if (pr.status === '확정') periodGroups[pr.period].confirmed++;
    else periodGroups[pr.period].temp++;
    periodGroups[pr.period].totalPay += pr.totalPay;
    periodGroups[pr.period].netPay += pr.netPay;
  }

  var html = '';
  var periods = Object.keys(periodGroups).sort().reverse();
  for (var pi = 0; pi < periods.length; pi++) {
    var pd = periods[pi];
    var pg = periodGroups[pd];
    var allConfirmed = pg.temp === 0;

    html += '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div style="display:flex;align-items:center;gap:12px;">' +
      '<h3 style="margin:0;">' + pd + '</h3>' +
      '<span style="font-size:12px;color:var(--gray-500);">' + pg.total + '명</span>' +
      '<span class="status-badge ' + (allConfirmed ? '확정' : '임시') + '">' + (allConfirmed ? '확정 완료' : pg.confirmed + '/' + pg.total + ' 확정') + '</span>' +
      '<span style="font-size:12px;">실지급 합계: <strong>' + formatNumber(pg.netPay) + '원</strong></span>' +
    '</div>';

    if (canPayrollAdmin) {
      html += '<div style="display:flex;gap:6px;">';
      if (pg.temp > 0) {
        html += '<button class="btn btn-sm btn-primary" onclick="handleConfirmPayroll(\'' + pd + '\')"><i class="fas fa-check-circle"></i> 일괄 확정 (' + pg.temp + '건)</button>';
      }
      if (pg.confirmed > 0 && isSuperAdmin()) {
        html += '<button class="btn btn-sm btn-outline" onclick="handleUnconfirmPayroll(\'' + pd + '\')" style="color:var(--danger);border-color:var(--danger);"><i class="fas fa-undo"></i> 확정 취소</button>';
      }
      html += '</div>';
    }

    html += '</div><div class="card-body" style="padding:0;overflow-x:auto;">';
  }

  html = '';

  // 기간별로 그룹핑하여 렌더링
  for (var pi2 = 0; pi2 < periods.length; pi2++) {
    var pd2 = periods[pi2];
    var pg2 = periodGroups[pd2];
    var allConfirmed2 = pg2.temp === 0;
    var periodPayrolls = payrolls.filter(function(p) { return p.period === pd2; });

    html += '<div class="card" style="margin-bottom:16px;"><div class="card-header" style="flex-wrap:wrap;gap:8px;">' +
      '<div style="display:flex;align-items:center;gap:12px;">' +
      '<h3 style="margin:0;">' + pd2 + '</h3>' +
      '<span style="font-size:12px;color:var(--gray-500);">' + pg2.total + '명</span>' +
      '<span class="status-badge ' + (allConfirmed2 ? '확정' : '임시') + '">' + (allConfirmed2 ? '확정 완료' : pg2.confirmed + '/' + pg2.total + ' 확정') + '</span>' +
      '<span style="font-size:12px;">실지급 합계: <strong>' + formatNumber(pg2.netPay) + '원</strong></span>' +
      '</div>';

    if (canPayrollAdmin) {
      html += '<div style="display:flex;gap:6px;">';
      if (pg2.temp > 0) {
        html += '<button class="btn btn-sm btn-primary" onclick="handleConfirmPayroll(\'' + pd2 + '\')"><i class="fas fa-check-circle"></i> 일괄 확정 (' + pg2.temp + '건)</button>';
      }
      if (pg2.confirmed > 0 && isSuperAdmin()) {
        html += '<button class="btn btn-sm btn-outline" onclick="handleUnconfirmPayroll(\'' + pd2 + '\')" style="color:var(--danger);border-color:var(--danger);"><i class="fas fa-undo"></i> 확정 취소</button>';
      }
      html += '</div>';
    }

    html += '</div><div class="card-body" style="padding:0;overflow-x:auto;">' +
      '<table><thead><tr>' +
      '<th>이름</th><th>조직</th><th>근무일</th><th>근무시간</th><th>기본급</th><th>연장</th><th>야간</th><th>주휴</th><th>총액</th><th>공제</th><th>실지급</th><th>상태</th><th>확정자</th><th></th>' +
    '</tr></thead><tbody>';

    for (var j = 0; j < periodPayrolls.length; j++) {
      var p = periodPayrolls[j];
      html += '<tr>' +
        '<td><strong>' + p.employeeName + '</strong></td>' +
        '<td>' + (p.org || '-') + '</td>' +
        '<td>' + p.totalDays + '</td>' +
        '<td>' + p.totalHours.toFixed(1) + 'h</td>' +
        '<td style="text-align:right;">' + formatNumber(p.basePay) + '</td>' +
        '<td style="text-align:right;">' + formatNumber(p.overtimePay) + '</td>' +
        '<td style="text-align:right;">' + formatNumber(p.nightPay) + '</td>' +
        '<td style="text-align:right;">' + formatNumber(p.weeklyHolidayPay) + '</td>' +
        '<td style="text-align:right;">' + formatNumber(p.totalPay) + '</td>' +
        '<td style="text-align:right;color:' + (p.deductions > 0 ? 'var(--danger)' : '') + ';">' + (p.deductions > 0 ? '-' + formatNumber(p.deductions) : '-') + '</td>' +
        '<td style="text-align:right;font-weight:700;">' + formatNumber(p.netPay) + '</td>' +
        '<td><span class="status-badge ' + p.status + '">' + p.status + '</span></td>' +
        '<td style="font-size:11px;color:var(--gray-500);">' + (p.confirmedBy || '-') + '</td>' +
        '<td><button class="btn btn-sm btn-outline" onclick="viewPayslip(\'' + p.id + '\')" style="font-size:11px;"><i class="fas fa-file-alt"></i> 명세서</button></td>' +
      '</tr>';
    }
    html += '</tbody></table></div></div>';
  }

  container.innerHTML = html;
}

function openPayrollCalcModal() {
  var now = new Date();
  document.getElementById('payrollCalcPeriod').value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  document.getElementById('payrollCalcOrg').value = '';
  document.getElementById('payrollCalcFinalize').checked = false;
  document.getElementById('payrollCalcModal').classList.add('active');
}

function closePayrollCalcModal() {
  document.getElementById('payrollCalcModal').classList.remove('active');
}

function submitPayrollCalc() {
  var period = document.getElementById('payrollCalcPeriod').value;
  if (!period) { showToast('정산 기간을 선택해주세요.', 'warning'); return; }

  var data = {
    period: period,
    org: document.getElementById('payrollCalcOrg').value,
    finalize: document.getElementById('payrollCalcFinalize').checked
  };

  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        closePayrollCalcModal();
        loadPayroll();
        showToast(result.message, 'success');
      } else {
        showToast(result.message, 'error');
      }
    })
    .withFailureHandler(errHandler)
    .calculatePayroll(data);
}

// ============ 급여 확정/확정취소 ============
function handleConfirmPayroll(period) {
  if (!confirm(period + ' 급여를 확정하시겠습니까?\n확정 후에는 해당 기간 출퇴근 기록 수정이 제한됩니다.')) return;
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        loadPayroll();
        showToast(result.message, 'success');
      } else {
        showToast(result.message, 'error');
      }
    })
    .withFailureHandler(function(err) {
      hideLoading();
      showToast('서버 오류: ' + err.message, 'error');
    })
    .confirmPayroll({ period: period });
}

function handleUnconfirmPayroll(period) {
  if (!confirm(period + ' 급여 확정을 취소하시겠습니까?\n확정 취소 시 출퇴근 기록도 확정 해제됩니다.')) return;
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        loadPayroll();
        showToast(result.message, 'success');
      } else {
        showToast(result.message, 'error');
      }
    })
    .withFailureHandler(function(err) {
      hideLoading();
      showToast('서버 오류: ' + err.message, 'error');
    })
    .unconfirmPayroll({ period: period });
}

// ============ 수동 출퇴근 ============
function openManualAttModal() {
  openAddAttRecordModal();
}

function closeManualAttModal() {
  closeAttRecordModal();
}

function submitManualAtt() {
  saveAttRecord();
}

// ============ 직원 관리 ============
function applyEmployeeFilters() {
  var org = document.getElementById('empFilterOrg').value;
  var status = document.getElementById('empFilterStatus').value;
  var keyword = document.getElementById('empFilterKeyword').value.toLowerCase();

  filteredEmployees = allEmployees.filter(function(e) {
    if (org && e.org !== org) return false;
    if (status && e.status !== status) return false;
    if (keyword) {
      var s = (e.name + e.email + e.phone + e.org).toLowerCase();
      if (s.indexOf(keyword) === -1) return false;
    }
    return true;
  });

  document.getElementById('empCountLabel').textContent = '검색 결과: ' + filteredEmployees.length + '명';
  renderEmployeeList();
}

function renderEmployeeList() {
  var container = document.getElementById('employeeListContainer');
  if (filteredEmployees.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><h3>직원이 없습니다</h3></div>';
    return;
  }

  var html = '<div class="table-wrapper"><table><thead><tr>' +
    '<th>ID</th><th>이름</th><th>이메일</th><th>조직</th><th>입사일</th><th>시급</th><th>연차</th><th>상태</th><th></th>' +
  '</tr></thead><tbody>';

  for (var i = 0; i < filteredEmployees.length; i++) {
    var e = filteredEmployees[i];
    html += '<tr>' +
      '<td style="font-size:11px;color:var(--gray-500);">' + e.id + '</td>' +
      '<td><strong>' + e.name + '</strong></td>' +
      '<td style="font-size:12px;">' + (e.email || '-') + '</td>' +
      '<td>' + (e.org || '-') + '</td>' +
      '<td style="font-size:12px;">' + (e.joinDate || '-') + '</td>' +
      '<td>' + formatNumber(e.hourlyWage) + '</td>' +
      '<td>' + e.annualLeave + '일</td>' +
      '<td><span class="status-badge ' + e.status + '">' + e.status + '</span></td>' +
      '<td style="white-space:nowrap;">' +
        '<button class="btn btn-sm btn-outline" onclick="viewHRInfo(\'' + e.name + '\')" title="HR 인사정보"><i class="fas fa-id-card"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="viewStaffLink(\'' + (e.email || '') + '\',\'' + e.name + '\')" title="스텝 연동"><i class="fas fa-link"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="openEditEmployeeModal(\'' + e.id + '\')"><i class="fas fa-edit"></i></button>' +
      '</td>' +
    '</tr>';
  }

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function openAddEmployeeModal() {
  document.getElementById('empModalTitle').textContent = '직원 등록';
  document.getElementById('empFormId').value = '';
  clearEmployeeForm();
  document.getElementById('empFormDuty').value = '경정청구팀';
  document.getElementById('empFormHourlyWage').value = '11000';
  document.getElementById('empFormDailyWage').value = '88000';
  document.getElementById('empFormAnnualLeave').value = '15';
  document.getElementById('empFormStatus').value = '재직';
  document.getElementById('employeeModal').classList.add('active');
}

function openEditEmployeeModal(id) {
  var emp = allEmployees.find(function(e) { return e.id === id; });
  if (!emp) return;

  document.getElementById('empModalTitle').textContent = '직원 수정';
  document.getElementById('empFormId').value = emp.id;
  document.getElementById('empFormName').value = emp.name || '';
  document.getElementById('empFormEmail').value = emp.email || '';
  document.getElementById('empFormPhone').value = emp.phone || '';
  document.getElementById('empFormOrg').value = emp.org || '';
  document.getElementById('empFormDuty').value = emp.duty || '';
  document.getElementById('empFormJoinDate').value = emp.joinDate || '';
  document.getElementById('empFormHourlyWage').value = emp.hourlyWage || 11000;
  document.getElementById('empFormDailyWage').value = emp.dailyWage || 88000;
  document.getElementById('empFormBankName').value = emp.bankName || '';
  document.getElementById('empFormBankAccount').value = emp.bankAccount || '';
  document.getElementById('empFormAnnualLeave').value = emp.annualLeave;
  document.getElementById('empFormStatus').value = emp.status || '재직';
  document.getElementById('empFormMemo').value = emp.memo || '';
  document.getElementById('employeeModal').classList.add('active');
}

function closeEmployeeModal() {
  document.getElementById('employeeModal').classList.remove('active');
}

function viewHRInfo(name) {
  showToast(name + ' HR 인사정보 조회 중...', 'info');
  google.script.run
    .withSuccessHandler(function(res) {
      if (!res.success) { showToast(res.message, 'error'); return; }
      if (!res.data) { showToast(res.message || 'HR 인사정보에 등록되지 않은 직원입니다.', 'info'); return; }
      var d = res.data;
      var renewalHtml = '';
      if (d.renewalDday !== null && d.renewalDday !== undefined) {
        var color = d.renewalDday <= 30 ? 'var(--danger)' : d.renewalDday <= 90 ? 'var(--warning)' : 'var(--gray-500)';
        renewalHtml = '<span style="margin-left:8px;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;color:#fff;background:' + color + ';">D-' + d.renewalDday + '</span>';
      }
      var html = '<div style="padding:20px;">' +
        '<h3 style="margin-bottom:16px;"><i class="fas fa-id-card" style="color:var(--primary);margin-right:6px;"></i>' + name + ' — HR 인사정보</h3>' +
        '<div style="display:grid;grid-template-columns:120px 1fr;gap:8px;font-size:13px;">' +
          '<span style="color:var(--gray-500);">팀</span><span>' + (d.team || '-') + '</span>' +
          '<span style="color:var(--gray-500);">재직상태</span><span><strong>' + (d.status || '-') + '</strong></span>' +
          '<span style="color:var(--gray-500);">직책/직급</span><span>' + (d.position || '-') + ' / ' + (d.rank || '-') + '</span>' +
          '<span style="color:var(--gray-500);">최초 입사일</span><span>' + (d.hireDate || '-') + '</span>' +
          '<span style="color:var(--gray-500);">수습종료일</span><span>' + (d.probationEnd || '-') + '</span>' +
        '</div>' +
        '<h4 style="font-size:13px;margin:16px 0 8px;padding-top:12px;border-top:1px solid var(--gray-200);">재계약 정보' + renewalHtml + '</h4>' +
        '<div style="display:grid;grid-template-columns:120px 1fr;gap:8px;font-size:13px;">' +
          '<span style="color:var(--gray-500);">최근 계약일</span><span>' + (d.latestContract || '-') + '</span>' +
          '<span style="color:var(--gray-500);">재계약 검토일</span><span style="font-weight:600;color:' + (d.renewalDday && d.renewalDday <= 30 ? 'var(--danger)' : 'inherit') + ';">' + (d.renewalReview || '-') + '</span>' +
          '<span style="color:var(--gray-500);">재계약 확정일</span><span>' + (d.renewalConfirm || '-') + '</span>' +
          '<span style="color:var(--gray-500);">규정 확정일</span><span>' + (d.renewalRuleConfirm || '-') + '</span>' +
          '<span style="color:var(--gray-500);">2년 한도일</span><span>' + (d.twoYearLimit || '-') + '</span>' +
        '</div>';
      if (d.resignDate) {
        html += '<div style="margin-top:12px;padding:8px 12px;background:#fef2f2;border-radius:8px;font-size:12px;color:var(--danger);">' +
          '<i class="fas fa-exclamation-circle"></i> 퇴사일: ' + d.resignDate + '</div>';
      }
      html += '<div style="text-align:right;margin-top:16px;"><button class="btn btn-outline" onclick="this.closest(\'.modal-overlay\').classList.remove(\'active\')">닫기</button></div></div>';
      var modal = document.createElement('div');
      modal.className = 'modal-overlay active';
      modal.style.zIndex = '10001';
      modal.innerHTML = '<div class="modal" style="max-width:480px;">' + html + '</div>';
      modal.addEventListener('click', function(evt) { if (evt.target === modal) modal.remove(); });
      document.body.appendChild(modal);
    })
    .withFailureHandler(function(err) { showToast('HR 조회 오류: ' + err.message, 'error'); })
    .getEmployeeHRInfo(name);
}

function viewStaffLink(email, name) {
  var searchKey = email || name;
  showToast(name + ' 스텝 정보 조회 중...', 'info');
  google.script.run
    .withSuccessHandler(function(res) {
      if (!res.success) { showToast(res.message, 'error'); return; }
      if (!res.data) { showToast(res.message || '스텝관리 시스템에 등록되지 않은 직원입니다.', 'info'); return; }
      var d = res.data;
      var ddayHtml = '';
      if (d.dday !== null && d.dday !== undefined) {
        var color = d.dday <= 3 ? 'var(--danger)' : d.dday <= 7 ? 'var(--warning)' : d.dday <= 30 ? 'var(--info)' : 'var(--gray-500)';
        ddayHtml = '<span style="margin-left:8px;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;color:#fff;background:' + color + ';">D-' + d.dday + '</span>';
      }
      var html = '<div style="padding:20px;">' +
        '<h3 style="margin-bottom:16px;"><i class="fas fa-link" style="color:var(--primary);margin-right:6px;"></i>' + name + ' — 스텝 정보' + ddayHtml + '</h3>' +
        '<div style="display:grid;grid-template-columns:100px 1fr;gap:8px;font-size:13px;">' +
          '<span style="color:var(--gray-500);">스텝ID</span><span>' + d.staffId + '</span>' +
          '<span style="color:var(--gray-500);">상태</span><span><strong>' + d.status + '</strong></span>' +
          '<span style="color:var(--gray-500);">계약기간</span><span>' + (d.contractStart || '') + ' ~ ' + (d.contractEnd || '') + '</span>' +
          '<span style="color:var(--gray-500);">조직/직무</span><span>' + (d.org || '-') + ' / ' + (d.duty || '-') + '</span>' +
          '<span style="color:var(--gray-500);">급여</span><span>' + (d.payType || '') + ' ' + (d.payAmount ? Number(d.payAmount).toLocaleString() + '원' : '-') + '</span>' +
        '</div>';
      if (d.evaluations && d.evaluations.length > 0) {
        html += '<h4 style="font-size:13px;margin:16px 0 8px;padding-top:12px;border-top:1px solid var(--gray-200);">최근 평가</h4>' +
          '<div class="table-wrapper"><table><thead><tr><th>일자</th><th>평균</th><th>등급</th><th>평가자</th></tr></thead><tbody>';
        for (var i = 0; i < Math.min(d.evaluations.length, 3); i++) {
          var ev = d.evaluations[i];
          html += '<tr><td>' + (ev.date || '-') + '</td><td>' + ev.avgScore + '</td><td><strong>' + ev.grade + '</strong></td><td>' + (ev.evaluator || '-') + '</td></tr>';
        }
        html += '</tbody></table></div>';
      }
      html += '<div style="text-align:right;margin-top:16px;"><button class="btn btn-outline" onclick="this.closest(\'.modal-overlay\').classList.remove(\'active\')">닫기</button></div></div>';
      var modal = document.createElement('div');
      modal.className = 'modal-overlay active';
      modal.style.zIndex = '10001';
      modal.innerHTML = '<div class="modal" style="max-width:480px;">' + html + '</div>';
      modal.addEventListener('click', function(evt) { if (evt.target === modal) modal.remove(); });
      document.body.appendChild(modal);
    })
    .withFailureHandler(function(err) { showToast('스텝 연동 오류: ' + err.message, 'error'); })
    .getEmployeeStaffInfo(searchKey);
}

function clearEmployeeForm() {
  var fields = ['empFormName', 'empFormEmail', 'empFormPhone', 'empFormOrg',
    'empFormDuty', 'empFormJoinDate', 'empFormHourlyWage', 'empFormDailyWage',
    'empFormBankName', 'empFormBankAccount', 'empFormAnnualLeave', 'empFormMemo'];
  for (var i = 0; i < fields.length; i++) {
    document.getElementById(fields[i]).value = '';
  }
}

function submitEmployeeForm() {
  var name = document.getElementById('empFormName').value.trim();
  if (!name) { showToast('이름은 필수 입력입니다.', 'warning'); return; }

  var formData = {
    id: document.getElementById('empFormId').value,
    name: name,
    email: document.getElementById('empFormEmail').value.trim(),
    phone: document.getElementById('empFormPhone').value.trim(),
    org: document.getElementById('empFormOrg').value,
    duty: document.getElementById('empFormDuty').value.trim(),
    joinDate: document.getElementById('empFormJoinDate').value,
    hourlyWage: document.getElementById('empFormHourlyWage').value,
    dailyWage: document.getElementById('empFormDailyWage').value,
    bankName: document.getElementById('empFormBankName').value.trim(),
    bankAccount: document.getElementById('empFormBankAccount').value.trim(),
    annualLeave: document.getElementById('empFormAnnualLeave').value,
    status: document.getElementById('empFormStatus').value,
    memo: document.getElementById('empFormMemo').value.trim()
  };

  var isEdit = !!formData.id;
  var fnName = isEdit ? 'updateEmployee' : 'addEmployee';

  document.getElementById('empFormSubmitBtn').disabled = true;
  showLoading();

  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      document.getElementById('empFormSubmitBtn').disabled = false;
      if (result.success) {
        if (isEdit) {
          for (var i = 0; i < allEmployees.length; i++) {
            if (allEmployees[i].id === result.employee.id) {
              allEmployees[i] = result.employee;
              break;
            }
          }
        } else {
          allEmployees.push(result.employee);
        }
        closeEmployeeModal();
        applyEmployeeFilters();
        showToast(result.message, 'success');
      } else {
        showToast(result.message, 'error');
      }
    })
    .withFailureHandler(function(err) {
      hideLoading();
      document.getElementById('empFormSubmitBtn').disabled = false;
      showToast('서버 오류: ' + err.message, 'error');
    })[fnName](formData);
}

// ============ 리포트 ============
function setReportPreset(preset) {
  var now = new Date();
  var y = now.getFullYear();
  var m = now.getMonth() + 1;
  if (preset === 'lastMonth') {
    m--;
    if (m === 0) { m = 12; y--; }
  }
  document.getElementById('reportPeriod').value = y + '-' + String(m).padStart(2, '0');
  loadReport();
}

function loadReport() {
  var period = document.getElementById('reportPeriod').value;
  var org = document.getElementById('reportOrg').value;
  if (!period) {
    setReportPreset('thisMonth');
    return;
  }

  var options = {
    activeOnly: document.getElementById('reportActiveOnly').checked,
    lateThreshold: document.getElementById('reportLateThreshold').value,
    earlyThreshold: document.getElementById('reportEarlyThreshold').value
  };

  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        renderReport(result.data);
      } else {
        document.getElementById('reportContainer').innerHTML =
          '<div class="empty-state"><i class="fas fa-chart-bar"></i><p>' + (result.message || '조회 실패') + '</p></div>';
      }
    })
    .withFailureHandler(errHandler)
    .getMonthlyReport(period, org, options);
}

function renderReport(data) {
  var container = document.getElementById('reportContainer');

  // 요약
  var html = '<div class="stats-grid" style="margin-bottom:24px;">' +
    '<div class="stat-card"><div class="stat-label">대상 직원</div><div class="stat-value">' + data.totalEmployees + '</div></div>' +
    '<div class="stat-card success"><div class="stat-label">소정근로일</div><div class="stat-value">' + data.totalScheduledDays + '</div></div>' +
    '<div class="stat-card info"><div class="stat-label">실제 근무일</div><div class="stat-value">' + data.totalWorkDays + '</div></div>' +
    '<div class="stat-card"><div class="stat-label">총 근무시간</div><div class="stat-value">' + data.totalWorkHours + 'h</div></div>' +
    '<div class="stat-card warning"><div class="stat-label">연장근로</div><div class="stat-value">' + data.totalOvertimeHours + 'h</div></div>' +
    (data.warningCount > 0 ? '<div class="stat-card danger"><div class="stat-label">주의 직원</div><div class="stat-value">' + data.warningCount + '</div></div>' : '') +
  '</div>';

  // 팀별 요약
  html += '<div class="card" style="margin-bottom:24px;"><div class="card-header"><h3>팀별 요약</h3></div><div class="card-body">' +
    '<div class="table-wrapper"><table><thead><tr>' +
    '<th>팀</th><th>인원</th><th>소정근로일</th><th>실제근무일</th><th>근무시간</th>' +
    '<th>연장</th><th>야간</th><th>휴가</th><th>지각</th><th>조퇴</th><th>결근</th>' +
    '</tr></thead><tbody>';

  var teamKeys = Object.keys(data.teamSummary);
  for (var t = 0; t < teamKeys.length; t++) {
    var team = data.teamSummary[teamKeys[t]];
    if (team.employees === 0) continue;
    html += '<tr>' +
      '<td><strong>' + teamKeys[t] + '</strong></td>' +
      '<td>' + team.employees + '</td>' +
      '<td>' + team.scheduledDays + '</td>' +
      '<td>' + team.actualDays + '</td>' +
      '<td>' + team.totalHours.toFixed(1) + 'h</td>' +
      '<td>' + (team.overtimeHours > 0 ? '<span style="color:var(--warning);">' + team.overtimeHours.toFixed(1) + 'h</span>' : '-') + '</td>' +
      '<td>' + (team.nightHours > 0 ? team.nightHours.toFixed(1) + 'h' : '-') + '</td>' +
      '<td>' + (team.leaveUsedDays > 0 ? team.leaveUsedDays + '일' : '-') + '</td>' +
      '<td>' + (team.lateCount > 0 ? '<span style="color:var(--danger);font-weight:600;">' + team.lateCount + '</span>' : '0') + '</td>' +
      '<td>' + (team.earlyLeaveCount > 0 ? team.earlyLeaveCount : '0') + '</td>' +
      '<td>' + (team.absentCount > 0 ? '<span style="color:var(--danger);">' + team.absentCount + '</span>' : '0') + '</td>' +
    '</tr>';
  }
  html += '</tbody></table></div></div></div>';

  // 직원별 상세
  html += '<div class="card"><div class="card-header"><h3>직원별 상세</h3></div><div class="card-body">' +
    '<div class="table-wrapper"><table><thead><tr>' +
    '<th>이름</th><th>조직</th><th>소정일</th><th>실제일</th><th>유급휴가</th>' +
    '<th>소정시간</th><th>근무시간</th><th>유급시간</th><th>연장</th><th>야간</th>' +
    '<th>휴가</th><th>차감</th><th>지각</th><th>조퇴</th><th>결근</th><th>누락</th>' +
    '</tr></thead><tbody>';

  for (var i = 0; i < data.employeeStats.length; i++) {
    var es = data.employeeStats[i];
    var warnIcon = es.hasWarning ? '<span style="color:var(--danger);margin-right:2px;" title="연장/야간근로 주의">&#9888;</span>' : '';
    // 근무시간 색상 (소정시간 대비 차이)
    var hoursClass = es.totalHours < es.scheduledHours ? ' style="color:var(--info);"' : '';

    html += '<tr>' +
      '<td><strong>' + warnIcon + es.employeeName + '</strong></td>' +
      '<td>' + (es.org || '-') + '</td>' +
      '<td>' + es.scheduledDays + '</td>' +
      '<td>' + es.actualDays + '</td>' +
      '<td style="color:var(--success);">' + (es.paidLeaveDays > 0 ? es.paidLeaveDays : '-') + '</td>' +
      '<td>' + es.scheduledHours + 'h</td>' +
      '<td' + hoursClass + '>' + es.totalHours + 'h</td>' +
      '<td>' + es.paidHours + 'h</td>' +
      '<td>' + (es.overtimeHours > 0 ? '<span style="color:var(--warning);">' + es.overtimeHours + 'h</span>' : '-') + '</td>' +
      '<td>' + (es.nightHours > 0 ? es.nightHours + 'h' : '-') + '</td>' +
      '<td>' + (es.leaveUsedDays > 0 ? es.leaveUsedDays + '일' : '-') + '</td>' +
      '<td>' + (es.leaveDeductDays > 0 ? es.leaveDeductDays + '일' : '-') + '</td>' +
      '<td>' + (es.lateCount > 0 ? '<span style="color:var(--danger);">' + es.lateCount + '</span>' : '0') + '</td>' +
      '<td>' + (es.earlyLeaveCount > 0 ? es.earlyLeaveCount : '0') + '</td>' +
      '<td>' + (es.absentCount > 0 ? '<span style="color:var(--danger);">' + es.absentCount + '</span>' : '0') + '</td>' +
      '<td>' + (es.missingClockOut > 0 ? '<span style="color:var(--warning);">' + es.missingClockOut + '</span>' : '0') + '</td>' +
    '</tr>';
  }
  html += '</tbody></table></div></div></div>';

  container.innerHTML = html;
}

// ============ 설정 ============

// 시프티(Shiftee) 참조 데이터 상수
var SHIFTEE_LABOR_INFO = [
  { name: '고객지원', wage: 12000, workDays: '월~금', restDay: '일', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '12h', memo: '2025.12.01 입사자부터' },
  { name: '고객지원(옛)', wage: 11000, workDays: '월~금', restDay: '토', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '12h', memo: '2024.12.20 이후 입사자부터' },
  { name: '뉴터칭콜', wage: 11000, workDays: '월~금', restDay: '일', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '12h', memo: '' },
  { name: '케어사업부문_현장실습', wage: 10367, workDays: '월~금', restDay: '일', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '0h', memo: '' },
  { name: '검토일반', wage: 11000, workDays: '월~금', restDay: '토,일', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '12h', memo: '5/7~ 검토 신입 시급 반영' },
  { name: '케어팀', wage: 12000, workDays: '월~금,일', restDay: '토', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '12h', memo: '' },
  { name: '기장내재화팀', wage: 12000, workDays: '월~금', restDay: '일', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '12h', memo: '' },
  { name: '검토(특)', wage: 13000, workDays: '월~금', restDay: '토', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '12h', memo: '' },
  { name: '터칭콜', wage: 12000, workDays: '월~금', restDay: '토', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '12h', memo: '9/6 공지, 9/7 신규입사자부터' },
  { name: '줍취', wage: 9860, workDays: '월~금', restDay: '토', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '12h', memo: '' },
  { name: '신고', wage: 11000, workDays: '월~금', restDay: '토', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '12h', memo: '9/6 공지, 9/7 신규입사자부터' },
  { name: '인용확인', wage: 12000, workDays: '월~금', restDay: '토', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '12h', memo: '9/6 공지, 9/7 신규입사자부터' },
  { name: '세무서대응', wage: 12000, workDays: '월~금', restDay: '토', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '12h', memo: '9/6 공지, 9/7 신규입사자부터' },
  { name: '검토', wage: 12000, workDays: '월~금', restDay: '토', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '12h', memo: '9/6 공지, 9/7 신규입사자부터' },
  { name: '작성', wage: 11000, workDays: '월~금', restDay: '토', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '12h', memo: '9/6 공지, 9/7 신규입사자부터' },
  { name: '분류1&사무보조', wage: 10000, workDays: '월~금', restDay: '토', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '12h', memo: '9/6 공지, 9/7 신규입사자부터' },
  { name: '줍줍&취소방어', wage: 13000, workDays: '월~금', restDay: '토', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '12h', memo: '9/6 공지, 9/7 신규입사자부터' },
  { name: '분류2', wage: 11000, workDays: '월~금', restDay: '토', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '12h', memo: '9/6 공지, 9/7 신규입사자부터' },
  { name: '1개월 단위 선택근무제', wage: 0, workDays: '월~금', restDay: '토', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '12h', memo: '' },
  { name: '일반근무', wage: 12000, workDays: '월~금', restDay: '토', rule: '주 40시간', overtimeMin: '0h', overtimeMax: '', memo: '' }
];

var SHIFTEE_LOCATIONS = [
  { name: '문정동', address: '서울 송파구 법원로 128 문정역SKV1', wifi: '121.165.242.229', gps: '', memo: '' },
  { name: '지수_5G', address: '지수회계법인', wifi: '121.165.242.229', gps: '', memo: '' },
  { name: '지수회계법인_케어사업부문_1', address: '지수회계법인', wifi: '218.145.201.73', gps: '', memo: '케어 5g' },
  { name: '지수회계법인_케어사업부문_2', address: '지수회계법인', wifi: '218.145.201.73', gps: '', memo: '지수5g' },
  { name: '경정청구팀[모바일]', address: '서울특별시 송파구 법원로 128', wifi: '121.165.242.229', gps: '', memo: '' },
  { name: '지수회계법인_좌표기반', address: '서울 송파구 법원로 128 문정역SKV1', wifi: '', gps: '37.48683, 127.12045 [120m]', memo: '' },
  { name: '고객지원/인용확인 젠트', address: '서울 강남구 테헤란로 507 위워크 삼성역', wifi: '125.143.163.33', gps: '', memo: 'WeWorkWiFi' },
  { name: '재택근무(고주영님)', address: '서울 송파구 법원로 128 문정SKV1 GL 메트로시티', wifi: '', gps: '37.27316, 127.05495 [150m]', memo: '' }
];

var SHIFTEE_LEAVE_TYPES = [
  { group: '', type: '무단 결근', timeOption: '하루 종일', paidHours: 0, deductDays: 0, special: '' },
  { group: '', type: '경조사(증빙제출완료)', timeOption: '하루 종일', paidHours: 0, deductDays: 0, special: '휴무' },
  { group: '', type: '무급휴가(대체근무)', timeOption: '하루 종일', paidHours: 8, deductDays: 1, special: '휴무' },
  { group: '', type: '병가(증빙제출완료)', timeOption: '하루 종일', paidHours: 0, deductDays: 0, special: '휴무' },
  { group: '', type: '예비군 훈련(유급6h)', timeOption: '시간 입력', paidHours: 6, deductDays: 0, special: '' },
  { group: '', type: '여성휴가(무급)', timeOption: '하루 종일', paidHours: 0, deductDays: 0, special: '휴무' },
  { group: '', type: '예비군 야간훈련(유급5h)', timeOption: '시간 입력', paidHours: 5, deductDays: 0, special: '' },
  { group: '', type: '예비군 훈련(유급8h)', timeOption: '시간 입력', paidHours: 8, deductDays: 0, special: '' },
  { group: '', type: '민방위훈련(유급4h)', timeOption: '시간 입력', paidHours: 4, deductDays: 0, special: '' },
  { group: '연차휴가', type: '반차(5h)', timeOption: '하루 종일', paidHours: 5, deductDays: 0.625, special: '' },
  { group: '연차휴가', type: '반반차', timeOption: '시간 입력', paidHours: 2, deductDays: 0.25, special: '' },
  { group: '연차휴가', type: '반차', timeOption: '시간 입력', paidHours: 4, deductDays: 0.5, special: '' },
  { group: '', type: '공휴일(유급3시간)', timeOption: '시간 입력', paidHours: 3, deductDays: 0, special: '' },
  { group: '', type: '공휴일(유급4시간)', timeOption: '시간 입력', paidHours: 4, deductDays: 0, special: '' },
  { group: '', type: '공휴일(유급)', timeOption: '시간 입력', paidHours: 8, deductDays: 0, special: '' },
  { group: '연차휴가', type: '연차', timeOption: '하루 종일', paidHours: 8, deductDays: 1, special: '' }
];

var SHIFTEE_TEMPLATES = [
  { name: '연장근무', start: '08:00', end: '17:00', org: '', color: '#A93226' },
  { name: '조기근무', start: '08:00', end: '17:00', org: '검토팀, 분류팀, 작성팀', color: '#f5b7b1' },
  { name: '점심 시간 없는 근무', start: '09:00', end: '13:00', org: '신고팀', color: '#f9e79f' },
  { name: '점심시간 없는 근무일정', start: '09:00', end: '13:00', org: '신고팀', color: '#5DADE2' },
  { name: '케어사업부분_현장실습', start: '09:00', end: '18:00', org: '케어사업부분_현장실습', color: '#5d6d7e' },
  { name: '주말근무', start: '09:00', end: '18:00', org: '전체 조직', color: '#a569bd' },
  { name: '케어팀', start: '09:00', end: '18:00', org: '케어팀', color: '#C0392B' },
  { name: '기장내재화팀', start: '09:00', end: '18:00', org: '기장내재화팀', color: '#f9e79f' },
  { name: '취소방어팀', start: '09:00', end: '18:00', org: '취소방어팀', color: '#78281F' },
  { name: '경정청구팀', start: '09:00', end: '18:00', org: '기장내재화팀', color: '#f9e79f' },
  { name: '일반근무', start: '09:00', end: '18:00', org: '', color: '#245DB3' },
  { name: '연장근무(야간)', start: '18:00', end: '20:00', org: '전체 조직', color: '#a93226' },
  { name: '재택근무', start: '13:00', end: '18:00', org: '', color: '#87b941' }
];

var FRONTEND_KOREAN_HOLIDAYS = {
  2024: ['2024-01-01','2024-02-09','2024-02-10','2024-02-11','2024-02-12','2024-03-01','2024-04-10','2024-05-05','2024-05-06','2024-05-15','2024-06-06','2024-08-15','2024-09-16','2024-09-17','2024-09-18','2024-10-03','2024-10-09','2024-12-25'],
  2025: ['2025-01-01','2025-01-28','2025-01-29','2025-01-30','2025-03-01','2025-05-05','2025-05-06','2025-06-06','2025-08-15','2025-10-03','2025-10-05','2025-10-06','2025-10-07','2025-10-08','2025-10-09','2025-12-25'],
  2026: ['2026-01-01','2026-02-16','2026-02-17','2026-02-18','2026-03-01','2026-03-02','2026-05-05','2026-05-24','2026-06-06','2026-08-15','2026-08-17','2026-09-24','2026-09-25','2026-09-26','2026-10-03','2026-10-05','2026-10-09','2026-12-25'],
  2027: ['2027-01-01','2027-02-06','2027-02-07','2027-02-08','2027-02-09','2027-03-01','2027-05-05','2027-05-13','2027-06-06','2027-06-07','2027-08-15','2027-08-16','2027-10-03','2027-10-04','2027-10-09','2027-10-11','2027-10-13','2027-10-14','2027-10-15','2027-12-25']
};

var _settingsData = null;
var currentSettingsTab = 'general';

function loadSettings() {
  if (!isSuperAdmin()) {
    document.getElementById('settingsContainer').innerHTML =
      '<div class="empty-state"><i class="fas fa-lock"></i><h3>권한 없음</h3><p>관리자만 접근할 수 있습니다.</p></div>';
    return;
  }
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        _settingsData = result.data;
        renderSettingsTab();
      }
    })
    .withFailureHandler(errHandler)
    .getSettings();
}

function switchSettingsTab(tab) {
  currentSettingsTab = tab;
  var tabs = document.querySelectorAll('#settingsTabBar .tab-item');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
  for (var j = 0; j < tabs.length; j++) {
    if (tabs[j].getAttribute('onclick').indexOf("'" + tab + "'") > -1) {
      tabs[j].classList.add('active');
    }
  }
  renderSettingsTab();
}

function renderSettingsTab() {
  var container = document.getElementById('settingsContainer');
  if (!_settingsData && currentSettingsTab === 'general') {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><h3>로딩 중...</h3></div>';
    return;
  }
  switch (currentSettingsTab) {
    case 'general': renderSettingsGeneral(container); break;
    case 'labor': renderSettingsLabor(container); break;
    case 'location': renderSettingsLocation(container); break;
    case 'leave-types': renderSettingsLeaveTypes(container); break;
    case 'templates': renderSettingsTemplates(container); break;
    case 'holidays': renderSettingsHolidays(container); break;
    case 'hr-sync': renderSettingsHRSync(container); break;
  }
}

function renderSettingsGeneral(container) {
  var settings = _settingsData;
  if (!settings) { container.innerHTML = '<div class="empty-state"><i class="fas fa-cog"></i><h3>설정 없음</h3></div>'; return; }
  var keys = Object.keys(settings);

  var categories = [
    { title: '급여', icon: 'won-sign', prefix: ['HOURLY_WAGE', 'DAILY_WAGE', 'PAY_ROUND_UNIT', 'CURRENCY'] },
    { title: '근무시간', icon: 'clock', prefix: ['OVERTIME_START', 'NIGHT_START', 'NIGHT_END', 'WEEKLY_HOLIDAY_THRESHOLD', 'WEEK_START_DAY'] },
    { title: '휴게시간', icon: 'coffee', prefix: ['BREAK_HOURS', 'BREAK_START', 'BREAK_END', 'BREAK_AUTO'] },
    { title: '출퇴근', icon: 'fingerprint', prefix: ['OFFICE_IPS', 'LATE_THRESHOLD', 'EARLY_THRESHOLD', 'ALLOW_NO_SCHEDULE', 'EARLY_CLOCKIN_LIMIT', 'MAX_CLOCK_DURATION', 'CLOCKOUT_CONFIRM'] },
    { title: '알림', icon: 'bell', prefix: ['NOTIFY_CLOCKIN', 'NOTIFY_CLOCKOUT', 'NOTIFY_LATE_MIN', 'NOTIFY_OVERTIME_MIN'] }
  ];

  var usedKeys = {};
  var html = '';

  for (var c = 0; c < categories.length; c++) {
    var cat = categories[c];
    var catKeys = cat.prefix.filter(function(k) { return settings[k]; });
    if (catKeys.length === 0) continue;

    html += '<div class="card" style="margin-bottom:16px;"><div class="card-header"><h3><i class="fas fa-' + cat.icon + '" style="margin-right:8px;color:var(--primary);"></i>' + cat.title + '</h3></div><div class="card-body">' +
      '<div class="table-wrapper"><table><thead><tr><th style="width:200px;">키</th><th style="width:220px;">값</th><th>설명</th><th style="width:40px;"></th></tr></thead><tbody>';

    for (var j = 0; j < catKeys.length; j++) {
      var k = catKeys[j];
      var s = settings[k];
      usedKeys[k] = true;
      html += '<tr>' +
        '<td><strong style="font-size:12px;">' + k + '</strong></td>' +
        '<td><input type="text" id="setting_' + k + '" value="' + (s.value || '') + '" style="width:100%;padding:6px 8px;border:1px solid var(--gray-300);border-radius:var(--radius-sm);font-size:13px;"></td>' +
        '<td style="font-size:12px;color:var(--gray-500);">' + (s.description || '') + '</td>' +
        '<td><button class="btn btn-sm btn-outline" onclick="saveSetting(\'' + k + '\')"><i class="fas fa-save"></i></button></td>' +
      '</tr>';
    }
    html += '</tbody></table></div></div></div>';
  }

  // 미분류 설정 (공휴일 키 제외 — 별도 탭)
  var holidayKeys = ['HOLIDAY_COUNTRY', 'COMPANY_HOLIDAYS'];
  var otherKeys = keys.filter(function(k) { return !usedKeys[k] && holidayKeys.indexOf(k) === -1; });
  if (otherKeys.length > 0) {
    html += '<div class="card" style="margin-bottom:16px;"><div class="card-header"><h3><i class="fas fa-sliders-h" style="margin-right:8px;color:var(--gray-500);"></i>기타</h3></div><div class="card-body">' +
      '<div class="table-wrapper"><table><thead><tr><th style="width:200px;">키</th><th style="width:220px;">값</th><th>설명</th><th style="width:40px;"></th></tr></thead><tbody>';
    for (var o = 0; o < otherKeys.length; o++) {
      var ok = otherKeys[o];
      var os = settings[ok];
      html += '<tr>' +
        '<td><strong style="font-size:12px;">' + ok + '</strong></td>' +
        '<td><input type="text" id="setting_' + ok + '" value="' + (os.value || '') + '" style="width:100%;padding:6px 8px;border:1px solid var(--gray-300);border-radius:var(--radius-sm);font-size:13px;"></td>' +
        '<td style="font-size:12px;color:var(--gray-500);">' + (os.description || '') + '</td>' +
        '<td><button class="btn btn-sm btn-outline" onclick="saveSetting(\'' + ok + '\')"><i class="fas fa-save"></i></button></td>' +
      '</tr>';
    }
    html += '</tbody></table></div></div></div>';
  }

  container.innerHTML = html;
}

function renderSettingsLabor(container) {
  var html = '<div class="alert-banner info" style="margin-bottom:16px;"><i class="fas fa-info-circle"></i> 시프티(Shiftee) 근로정보 데이터 참조용입니다. (총 ' + SHIFTEE_LABOR_INFO.length + '건)</div>';
  html += '<div class="card"><div class="card-header"><h3><i class="fas fa-briefcase" style="margin-right:8px;color:var(--primary);"></i>근로정보 목록</h3></div><div class="card-body">' +
    '<div class="table-wrapper"><table><thead><tr>' +
    '<th>근로정보명</th><th style="text-align:right;">시급</th><th>소정근로요일</th><th>주휴요일</th><th>근로규칙</th><th>연장최소</th><th>연장최대</th><th>메모</th>' +
    '</tr></thead><tbody>';
  for (var i = 0; i < SHIFTEE_LABOR_INFO.length; i++) {
    var l = SHIFTEE_LABOR_INFO[i];
    html += '<tr>' +
      '<td><strong>' + l.name + '</strong></td>' +
      '<td style="text-align:right;">' + (l.wage > 0 ? l.wage.toLocaleString() + '원' : '-') + '</td>' +
      '<td>' + l.workDays + '</td>' +
      '<td>' + l.restDay + '</td>' +
      '<td>' + l.rule + '</td>' +
      '<td>' + l.overtimeMin + '</td>' +
      '<td>' + l.overtimeMax + '</td>' +
      '<td style="font-size:12px;color:var(--gray-500);">' + l.memo + '</td>' +
    '</tr>';
  }
  html += '</tbody></table></div></div></div>';
  container.innerHTML = html;
}

function renderSettingsLocation(container) {
  var html = '';

  // 현재 시스템 출퇴근 IP 설정
  if (_settingsData && _settingsData['OFFICE_IPS']) {
    var ipSetting = _settingsData['OFFICE_IPS'];
    html += '<div class="card" style="margin-bottom:16px;"><div class="card-header"><h3><i class="fas fa-wifi" style="margin-right:8px;color:var(--primary);"></i>현재 시스템 출퇴근 IP 설정</h3></div><div class="card-body">' +
      '<div style="display:flex;gap:8px;align-items:center;">' +
      '<input type="text" id="setting_OFFICE_IPS" value="' + (ipSetting.value || '') + '" style="flex:1;padding:8px 12px;border:1px solid var(--gray-300);border-radius:var(--radius-sm);font-size:13px;" placeholder="IP 주소 (쉼표 구분)">' +
      '<button class="btn btn-primary btn-sm" onclick="saveSetting(\'OFFICE_IPS\')"><i class="fas fa-save"></i> 저장</button>' +
      '</div>' +
      '<p style="font-size:12px;color:var(--gray-500);margin-top:8px;">' + (ipSetting.description || '출퇴근 인증용 사무실 IP 주소') + '</p>' +
      '</div></div>';
  }

  // 시프티 참조 데이터
  html += '<div class="alert-banner info" style="margin-bottom:16px;"><i class="fas fa-info-circle"></i> 시프티(Shiftee) 출퇴근장소 데이터 참조용입니다. (총 ' + SHIFTEE_LOCATIONS.length + '건)</div>';
  html += '<div class="card"><div class="card-header"><h3><i class="fas fa-map-marker-alt" style="margin-right:8px;color:var(--primary);"></i>출퇴근장소 목록</h3></div><div class="card-body">' +
    '<div class="table-wrapper"><table><thead><tr>' +
    '<th>장소명</th><th>주소</th><th>WiFi IP</th><th>GPS 좌표</th><th>메모</th>' +
    '</tr></thead><tbody>';
  for (var i = 0; i < SHIFTEE_LOCATIONS.length; i++) {
    var loc = SHIFTEE_LOCATIONS[i];
    html += '<tr>' +
      '<td><strong>' + loc.name + '</strong></td>' +
      '<td style="font-size:12px;">' + loc.address + '</td>' +
      '<td><code style="font-size:12px;">' + (loc.wifi || '-') + '</code></td>' +
      '<td style="font-size:12px;">' + (loc.gps || '-') + '</td>' +
      '<td style="font-size:12px;color:var(--gray-500);">' + loc.memo + '</td>' +
    '</tr>';
  }
  html += '</tbody></table></div></div></div>';
  container.innerHTML = html;
}

function renderSettingsLeaveTypes(container) {
  var html = '';

  // 현재 시스템 휴가유형
  html += '<div class="card" style="margin-bottom:16px;"><div class="card-header"><h3><i class="fas fa-calendar-check" style="margin-right:8px;color:var(--primary);"></i>현재 시스템 휴가유형</h3></div><div class="card-body">';
  if (leaveTypes && leaveTypes.length > 0) {
    html += '<div class="table-wrapper"><table><thead><tr><th>유형명</th><th>유급여부</th></tr></thead><tbody>';
    for (var i = 0; i < leaveTypes.length; i++) {
      html += '<tr><td>' + leaveTypes[i] + '</td><td>-</td></tr>';
    }
    html += '</tbody></table></div>';
  } else {
    html += '<p style="color:var(--gray-500);font-size:13px;">시스템에 등록된 휴가유형이 없습니다.</p>';
  }
  html += '</div></div>';

  // 시프티 참조 데이터
  html += '<div class="alert-banner info" style="margin-bottom:16px;"><i class="fas fa-info-circle"></i> 시프티(Shiftee) 휴가유형 데이터 참조용입니다. (총 ' + SHIFTEE_LEAVE_TYPES.length + '건)</div>';
  html += '<div class="card"><div class="card-header"><h3><i class="fas fa-umbrella-beach" style="margin-right:8px;color:var(--primary);"></i>시프티 휴가유형 목록</h3></div><div class="card-body">' +
    '<div class="table-wrapper"><table><thead><tr>' +
    '<th>휴가그룹</th><th>유형</th><th>시간옵션</th><th style="text-align:right;">유급시간</th><th style="text-align:right;">차감일수</th><th>특별옵션</th>' +
    '</tr></thead><tbody>';
  for (var j = 0; j < SHIFTEE_LEAVE_TYPES.length; j++) {
    var lt = SHIFTEE_LEAVE_TYPES[j];
    html += '<tr>' +
      '<td>' + (lt.group || '<span style="color:var(--gray-400);">-</span>') + '</td>' +
      '<td><strong>' + lt.type + '</strong></td>' +
      '<td>' + lt.timeOption + '</td>' +
      '<td style="text-align:right;">' + lt.paidHours + 'h</td>' +
      '<td style="text-align:right;">' + lt.deductDays + '</td>' +
      '<td>' + (lt.special || '-') + '</td>' +
    '</tr>';
  }
  html += '</tbody></table></div></div></div>';
  container.innerHTML = html;
}

function renderSettingsTemplates(container) {
  var html = '';

  // 현재 시스템 근무템플릿
  html += '<div class="card" style="margin-bottom:16px;"><div class="card-header"><h3><i class="fas fa-calendar-alt" style="margin-right:8px;color:var(--primary);"></i>현재 시스템 근무템플릿</h3></div><div class="card-body">';
  if (allTemplates && allTemplates.length > 0) {
    html += '<div class="table-wrapper"><table><thead><tr><th>템플릿명</th><th>시작</th><th>종료</th><th>색상</th></tr></thead><tbody>';
    for (var i = 0; i < allTemplates.length; i++) {
      var t = allTemplates[i];
      html += '<tr>' +
        '<td><strong>' + (t.name || '') + '</strong></td>' +
        '<td>' + (t.startTime || '') + '</td>' +
        '<td>' + (t.endTime || '') + '</td>' +
        '<td><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' + (t.color || '#999') + ';vertical-align:middle;margin-right:4px;"></span>' + (t.color || '') + '</td>' +
      '</tr>';
    }
    html += '</tbody></table></div>';
  } else {
    html += '<p style="color:var(--gray-500);font-size:13px;">시스템에 등록된 근무템플릿이 없습니다.</p>';
  }
  html += '</div></div>';

  // 시프티 참조 데이터
  html += '<div class="alert-banner info" style="margin-bottom:16px;"><i class="fas fa-info-circle"></i> 시프티(Shiftee) 근무템플릿 데이터 참조용입니다. (총 ' + SHIFTEE_TEMPLATES.length + '건)</div>';
  html += '<div class="card"><div class="card-header"><h3><i class="fas fa-th-list" style="margin-right:8px;color:var(--primary);"></i>시프티 근무템플릿 목록</h3></div><div class="card-body">' +
    '<div class="table-wrapper"><table><thead><tr>' +
    '<th>템플릿명</th><th>시작시간</th><th>종료시간</th><th>조직</th><th>색상</th>' +
    '</tr></thead><tbody>';
  for (var j = 0; j < SHIFTEE_TEMPLATES.length; j++) {
    var st = SHIFTEE_TEMPLATES[j];
    html += '<tr>' +
      '<td><strong>' + st.name + '</strong></td>' +
      '<td>' + st.start + '</td>' +
      '<td>' + st.end + '</td>' +
      '<td style="font-size:12px;">' + (st.org || '<span style="color:var(--gray-400);">전체</span>') + '</td>' +
      '<td><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' + st.color + ';vertical-align:middle;margin-right:4px;"></span>' + st.color + '</td>' +
    '</tr>';
  }
  html += '</tbody></table></div></div></div>';
  container.innerHTML = html;
}

function renderSettingsHolidays(container) {
  var html = '';

  // 시스템 공휴일 설정
  if (_settingsData) {
    var holidayKeys = ['HOLIDAY_COUNTRY', 'COMPANY_HOLIDAYS'];
    var hasHolidaySettings = false;
    for (var h = 0; h < holidayKeys.length; h++) {
      if (_settingsData[holidayKeys[h]]) { hasHolidaySettings = true; break; }
    }
    if (hasHolidaySettings) {
      html += '<div class="card" style="margin-bottom:16px;"><div class="card-header"><h3><i class="fas fa-building" style="margin-right:8px;color:var(--primary);"></i>시스템 공휴일 설정</h3></div><div class="card-body">' +
        '<div class="table-wrapper"><table><thead><tr><th style="width:200px;">키</th><th style="width:300px;">값</th><th>설명</th><th style="width:40px;"></th></tr></thead><tbody>';
      for (var hk = 0; hk < holidayKeys.length; hk++) {
        var key = holidayKeys[hk];
        var s = _settingsData[key];
        if (!s) continue;
        html += '<tr>' +
          '<td><strong style="font-size:12px;">' + key + '</strong></td>' +
          '<td><input type="text" id="setting_' + key + '" value="' + (s.value || '') + '" style="width:100%;padding:6px 8px;border:1px solid var(--gray-300);border-radius:var(--radius-sm);font-size:13px;"></td>' +
          '<td style="font-size:12px;color:var(--gray-500);">' + (s.description || '') + '</td>' +
          '<td><button class="btn btn-sm btn-outline" onclick="saveSetting(\'' + key + '\')"><i class="fas fa-save"></i></button></td>' +
        '</tr>';
      }
      html += '</tbody></table></div></div></div>';
    }
  }

  // 연도별 한국 공휴일 목록
  html += '<div class="alert-banner info" style="margin-bottom:16px;"><i class="fas fa-info-circle"></i> 한국 공휴일 목록 (시스템 내장 데이터)</div>';
  var years = Object.keys(FRONTEND_KOREAN_HOLIDAYS).sort();
  for (var y = 0; y < years.length; y++) {
    var year = years[y];
    var holidays = FRONTEND_KOREAN_HOLIDAYS[year];
    html += '<div class="card" style="margin-bottom:12px;"><div class="card-header" style="padding:10px 16px;"><h3 style="font-size:14px;"><i class="fas fa-calendar-day" style="margin-right:8px;color:var(--primary);"></i>' + year + '년 공휴일 (' + holidays.length + '일)</h3></div><div class="card-body" style="padding:12px 16px;">';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
    var dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    for (var d = 0; d < holidays.length; d++) {
      var dt = new Date(holidays[d] + 'T00:00:00');
      var dayName = dayNames[dt.getDay()];
      var mm = holidays[d].substring(5, 7);
      var dd = holidays[d].substring(8, 10);
      html += '<span style="display:inline-block;padding:4px 10px;background:var(--danger-light);color:var(--danger);border-radius:var(--radius-sm);font-size:12px;font-weight:500;">' + mm + '/' + dd + '(' + dayName + ')</span>';
    }
    html += '</div></div></div>';
  }

  container.innerHTML = html;
}

function saveSetting(key) {
  var val = document.getElementById('setting_' + key).value;
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        showToast(result.message, 'success');
        if (_settingsData && _settingsData[key]) { _settingsData[key].value = val; }
      }
      else { showToast(result.message, 'error'); }
    })
    .withFailureHandler(errHandler)
    .updateSetting(key, val);
}

function renderSettingsHRSync(container) {
  var html = '<div class="card" style="margin-bottom:16px;">' +
    '<div class="card-header"><h3><i class="fas fa-sync-alt" style="margin-right:8px;color:var(--primary);"></i>HR 데이터 동기화</h3></div>' +
    '<div class="card-body">' +
      '<p style="font-size:13px;color:var(--gray-600);margin-bottom:16px;">환급사업부_운영_인사&행정 스프레드시트의 <strong>직원_고용현황</strong> 시트 데이터를 근태관리 직원 목록에 동기화합니다.</p>' +
      '<div class="alert-banner info" style="margin-bottom:16px;">' +
        '<i class="fas fa-info-circle"></i> 동기화 규칙:<br>' +
        '&bull; 신규 직원(이름 기준): 자동 추가 (시급 11,000원, 연차 15일 기본값)<br>' +
        '&bull; 기존 직원: 팀/상태만 업데이트 (기존 데이터 유지)<br>' +
        '&bull; 팀명 자동 변환: 검토1팀/2팀→검토팀, 터칭콜팀→뉴터칭콜팀' +
      '</div>' +
      '<div id="hrSyncResult" style="display:none;margin-bottom:16px;"></div>' +
      '<button class="btn btn-primary" id="hrSyncBtn" onclick="runHRSync()"><i class="fas fa-sync-alt"></i> HR 동기화 실행</button>' +
    '</div>' +
  '</div>';

  html += '<div class="card" style="margin-bottom:16px;">' +
    '<div class="card-header"><h3><i class="fas fa-users" style="margin-right:8px;color:var(--primary);"></i>팀장 목록 (HR)</h3></div>' +
    '<div class="card-body"><div id="teamLeadersList"><p style="color:var(--gray-400);font-size:12px;">불러오는 중...</p></div></div>' +
  '</div>';

  // 퇴사자 이력 조회 카드
  html += '<div class="card">' +
    '<div class="card-header"><h3><i class="fas fa-user-slash" style="margin-right:8px;color:var(--danger);"></i>퇴사자 이력 조회</h3></div>' +
    '<div class="card-body">' +
      '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">' +
        '<input type="text" id="departedKeyword" placeholder="이름 또는 업무 검색" style="width:200px;font-size:13px;">' +
        '<select id="departedTeam" style="font-size:13px;">' +
          '<option value="">전체 업무</option>' +
          '<option value="검토">검토</option>' +
          '<option value="분류">분류</option>' +
          '<option value="작성">작성</option>' +
          '<option value="신고">신고</option>' +
          '<option value="인용확인">인용확인</option>' +
          '<option value="터칭콜">터칭콜</option>' +
          '<option value="세무서대응">세무서대응</option>' +
          '<option value="고객지원">고객지원</option>' +
          '<option value="복붙">복붙</option>' +
        '</select>' +
        '<button class="btn btn-primary btn-sm" onclick="searchDeparted()"><i class="fas fa-search"></i> 조회</button>' +
      '</div>' +
      '<div id="departedResult"></div>' +
    '</div>' +
  '</div>';

  // Slack 연동 카드
  html += '<div class="card" style="margin-top:16px;">' +
    '<div class="card-header"><h3><i class="fab fa-slack" style="margin-right:8px;color:#4A154B;"></i>Slack 연동</h3></div>' +
    '<div class="card-body">' +
      '<p style="font-size:13px;color:var(--gray-600);margin-bottom:12px;">팀장에게 재계약 검토 알림을 Slack DM으로 발송합니다.</p>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">' +
        '<label style="font-size:13px;font-weight:600;white-space:nowrap;">Bot Token:</label>' +
        '<input type="password" id="slackTokenInput" placeholder="xoxb-..." style="flex:1;font-size:13px;">' +
        '<button class="btn btn-outline btn-sm" onclick="saveSlackToken()">저장</button>' +
      '</div>' +
      '<div id="slackSendResult" style="display:none;margin-bottom:12px;"></div>' +
      '<button class="btn btn-primary btn-sm" id="slackSendBtn" onclick="sendSlackAlerts()"><i class="fab fa-slack"></i> 재계약 알림 발송</button>' +
      '<p style="font-size:11px;color:var(--gray-400);margin-top:8px;">D-30일 이내 미확정 건만 발송됩니다. 총괄관리자 권한 필요.</p>' +
    '</div>' +
  '</div>';

  container.innerHTML = html;
  loadTeamLeaders_();
  loadSlackToken_();
}

function runHRSync() {
  if (!confirm('HR 데이터를 동기화합니다. 계속하시겠습니까?')) return;
  document.getElementById('hrSyncBtn').disabled = true;
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      document.getElementById('hrSyncBtn').disabled = false;
      var div = document.getElementById('hrSyncResult');
      div.style.display = 'block';
      if (result.success) {
        var d = result.data;
        div.className = 'alert-banner success';
        div.innerHTML = '<i class="fas fa-check-circle"></i> ' + result.message;
        showToast(result.message, 'success');
        if (d.added > 0 || d.updated > 0) {
          google.script.run.withSuccessHandler(function(res) {
            if (res.success) { allEmployees = res.employees || []; filteredEmployees = allEmployees.slice(); }
          }).getInitialData();
        }
      } else {
        div.className = 'alert-banner error';
        div.innerHTML = '<i class="fas fa-times-circle"></i> ' + result.message;
        showToast(result.message, 'error');
      }
    })
    .withFailureHandler(function(err) {
      hideLoading();
      document.getElementById('hrSyncBtn').disabled = false;
      showToast('동기화 오류: ' + err.message, 'error');
    })
    .syncEmployeesFromHR();
}

function loadTeamLeaders_() {
  google.script.run
    .withSuccessHandler(function(res) {
      var el = document.getElementById('teamLeadersList');
      if (!el) return;
      if (!res.success || !res.data || res.data.length === 0) {
        el.innerHTML = '<p style="color:var(--gray-400);font-size:12px;">' + (res.message || '팀장 데이터 없음') + '</p>';
        return;
      }
      var html = '<div class="table-wrapper"><table><thead><tr><th>팀(원본)</th><th>팀(정규화)</th><th>팀장</th><th>Slack ID</th></tr></thead><tbody>';
      for (var i = 0; i < res.data.length; i++) {
        var l = res.data[i];
        html += '<tr><td>' + l.team + '</td><td>' + l.teamNormalized + '</td><td><strong>' + l.name + '</strong></td>' +
          '<td style="font-size:12px;font-family:monospace;">' + (l.slackId || '-') + '</td></tr>';
      }
      html += '</tbody></table></div>';
      el.innerHTML = html;
    })
    .withFailureHandler(function() {
      var el = document.getElementById('teamLeadersList');
      if (el) el.innerHTML = '<p style="color:var(--gray-400);font-size:12px;">팀장목록 조회 실패</p>';
    })
    .getTeamLeaders();
}

function searchDeparted() {
  var keyword = document.getElementById('departedKeyword').value.trim();
  var team = document.getElementById('departedTeam').value;
  var resultDiv = document.getElementById('departedResult');
  resultDiv.innerHTML = '<p style="color:var(--gray-400);font-size:12px;"><i class="fas fa-spinner fa-spin"></i> 조회 중...</p>';

  google.script.run
    .withSuccessHandler(function(res) {
      if (!res.success) {
        resultDiv.innerHTML = '<p style="color:var(--danger);font-size:12px;">' + res.message + '</p>';
        return;
      }
      if (!res.data || res.data.length === 0) {
        resultDiv.innerHTML = '<p style="color:var(--gray-400);font-size:13px;">검색 결과가 없습니다.</p>';
        return;
      }
      var html = '<p style="font-size:12px;color:var(--gray-500);margin-bottom:8px;">총 ' + res.total + '건</p>';
      html += '<div class="table-wrapper"><table><thead><tr>' +
        '<th>이름</th><th>구분</th><th>업무</th><th>출근일</th><th>퇴사일</th><th>근속(일)</th><th>사유</th>' +
        '</tr></thead><tbody>';
      for (var i = 0; i < res.data.length; i++) {
        var d = res.data[i];
        html += '<tr><td><strong>' + d.name + '</strong></td>' +
          '<td style="font-size:12px;">' + d.source + '</td>' +
          '<td>' + d.job + '</td>' +
          '<td style="font-size:12px;">' + (d.hireDate || '-') + '</td>' +
          '<td style="font-size:12px;">' + (d.resignDate || '-') + '</td>' +
          '<td style="text-align:center;">' + (d.daysWorked !== '' ? d.daysWorked : '-') + '</td>' +
          '<td style="font-size:12px;">' + (d.reason || '-') + '</td></tr>';
      }
      html += '</tbody></table></div>';
      if (res.total >= 200) {
        html += '<p style="font-size:11px;color:var(--gray-400);margin-top:8px;">최대 200건까지 표시됩니다. 검색 조건을 좁혀주세요.</p>';
      }
      resultDiv.innerHTML = html;
    })
    .withFailureHandler(function(err) {
      resultDiv.innerHTML = '<p style="color:var(--danger);font-size:12px;">조회 실패: ' + err.message + '</p>';
    })
    .getDepartedList({ keyword: keyword, team: team });
}

function loadSlackToken_() {
  google.script.run
    .withSuccessHandler(function(res) {
      if (res.success && res.data) {
        var settings = res.data;
        for (var i = 0; i < settings.length; i++) {
          if (settings[i].key === 'slackBotToken' && settings[i].value) {
            var input = document.getElementById('slackTokenInput');
            if (input) input.value = settings[i].value;
            break;
          }
        }
      }
    })
    .withFailureHandler(function() {})
    .getSettings();
}

function saveSlackToken() {
  var token = document.getElementById('slackTokenInput').value.trim();
  if (!token) { showToast('Bot Token을 입력하세요.', 'error'); return; }
  google.script.run
    .withSuccessHandler(function(res) {
      showToast(res.success ? 'Slack 토큰 저장 완료' : res.message, res.success ? 'success' : 'error');
    })
    .withFailureHandler(function(err) { showToast('저장 실패: ' + err.message, 'error'); })
    .updateSetting('slackBotToken', token);
}

function sendSlackAlerts() {
  if (!confirm('재계약 미확정 건에 대해 팀장에게 Slack 알림을 발송합니다. 계속하시겠습니까?')) return;
  document.getElementById('slackSendBtn').disabled = true;
  showLoading();
  google.script.run
    .withSuccessHandler(function(res) {
      hideLoading();
      document.getElementById('slackSendBtn').disabled = false;
      var div = document.getElementById('slackSendResult');
      div.style.display = 'block';
      if (res.success) {
        div.className = 'alert-banner success';
        div.innerHTML = '<i class="fas fa-check-circle"></i> ' + res.message;
        showToast(res.message, 'success');
      } else {
        div.className = 'alert-banner error';
        div.innerHTML = '<i class="fas fa-times-circle"></i> ' + res.message;
        showToast(res.message, 'error');
      }
    })
    .withFailureHandler(function(err) {
      hideLoading();
      document.getElementById('slackSendBtn').disabled = false;
      showToast('발송 실패: ' + err.message, 'error');
    })
    .sendRenewalSlackAlerts();
}

// ============ 정산 마감 ============

function loadClosingList() {
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) renderClosingList(result.data);
      else showToast(result.message, 'error');
    })
    .withFailureHandler(errHandler)
    .getClosingList();
}

function renderClosingList(list) {
  var container = document.getElementById('payrollContainer');
  var html = '<div class="card"><div class="card-header"><h3><i class="fas fa-lock" style="margin-right:8px;color:var(--danger);"></i>정산 마감 관리</h3>';
  html += '<div class="header-actions"><div class="form-group" style="margin:0;display:flex;gap:8px;align-items:center;">';
  html += '<input type="month" id="closingPeriod" style="padding:6px 10px;border:1px solid var(--gray-300);border-radius:var(--radius-sm);font-size:13px;">';
  html += '<button class="btn btn-sm btn-danger" onclick="closePeriodAction()"><i class="fas fa-lock"></i> 마감</button>';
  html += '</div></div></div><div class="card-body">';

  if (list.length === 0) {
    html += '<p style="text-align:center;color:var(--gray-500);padding:20px;">마감 내역이 없습니다.</p>';
  } else {
    html += '<div class="table-wrapper"><table><thead><tr><th>정산기간</th><th>마감일</th><th>처리자</th><th>상태</th><th></th></tr></thead><tbody>';
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var badge = c.status === '마감' ? '<span class="status-badge" style="background:var(--danger-light);color:var(--danger);">마감</span>' :
        '<span class="status-badge" style="background:var(--gray-100);color:var(--gray-500);">해제</span>';
      html += '<tr><td><strong>' + c.period + '</strong></td><td>' + c.closedAt + '</td><td>' + c.closedBy + '</td><td>' + badge + '</td>';
      html += '<td>';
      if (c.status === '마감' && isSuperAdmin()) {
        html += '<button class="btn btn-sm btn-outline" onclick="reopenPeriodAction(\'' + c.period + '\')"><i class="fas fa-unlock"></i> 해제</button>';
      }
      html += '</td></tr>';
    }
    html += '</tbody></table></div>';
  }
  html += '</div></div>';
  container.innerHTML = html;
}

function closePeriodAction() {
  var period = document.getElementById('closingPeriod').value;
  if (!period) { showToast('마감할 기간을 선택해주세요.', 'warning'); return; }
  if (!confirm(period + ' 기간을 마감하시겠습니까?\n마감 후 해당 기간의 근태 데이터를 수정할 수 없습니다.')) return;
  showLoading();
  google.script.run
    .withSuccessHandler(function(r) { hideLoading(); if (r.success) { loadClosingList(); showToast(r.message, 'success'); } else showToast(r.message, 'error'); })
    .withFailureHandler(errHandler)
    .closePeriod(period);
}

function reopenPeriodAction(period) {
  if (!confirm(period + ' 기간 마감을 해제하시겠습니까?')) return;
  showLoading();
  google.script.run
    .withSuccessHandler(function(r) { hideLoading(); if (r.success) { loadClosingList(); showToast(r.message, 'success'); } else showToast(r.message, 'error'); })
    .withFailureHandler(errHandler)
    .reopenPeriod(period);
}

// ============ 직원 요청 ============

var allRequests = [];
var currentRequestTab = 'my';

function loadRequests() {
  showLoading();
  var filters = {};
  if (currentRequestTab === 'my') {
    // 서버에서 직원 필터링
  }
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        allRequests = result.data;
        renderRequestList();
      } else { showToast(result.message, 'error'); }
    })
    .withFailureHandler(errHandler)
    .getRequestList(filters);
}

function switchRequestTab(tab) {
  currentRequestTab = tab;
  var tabs = document.querySelectorAll('#requestTabBar .tab-item');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
  for (var j = 0; j < tabs.length; j++) {
    if (tabs[j].getAttribute('onclick').indexOf("'" + tab + "'") > -1) {
      tabs[j].classList.add('active');
    }
  }
  loadRequests();
}

function renderRequestList() {
  var container = document.getElementById('requestContainer');
  var filtered = allRequests;

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-hand-paper"></i><h3>요청 없음</h3><p>등록된 요청이 없습니다.</p></div>';
    return;
  }

  var html = '<div class="table-wrapper"><table><thead><tr>';
  html += '<th>요청일</th><th>직원</th><th>유형</th><th>내용 요약</th><th>상태</th>';
  if (isManager()) html += '<th>처리</th>';
  html += '</tr></thead><tbody>';

  for (var i = 0; i < filtered.length; i++) {
    var r = filtered[i];
    var typeLabel = { '근무일정생성요청': '일정', '휴가생성요청': '휴가', '출퇴근기록수정요청': '출퇴근' }[r.requestType] || r.requestType;
    var statusBadge = r.status === '대기' ? '<span class="status-badge" style="background:var(--warning-light);color:#8D6E00;">대기</span>' :
      r.status === '승인' ? '<span class="status-badge" style="background:var(--success-light);color:var(--success);">승인</span>' :
      '<span class="status-badge" style="background:var(--danger-light);color:var(--danger);">반려</span>';

    var summary = '';
    if (r.requestType === '근무일정생성요청') summary = (r.content.date || '') + ' ' + (r.content.startTime || '') + '~' + (r.content.endTime || '');
    else if (r.requestType === '휴가생성요청') summary = (r.content.leaveType || '') + ' ' + (r.content.startDate || '') + '~' + (r.content.endDate || '');
    else if (r.requestType === '출퇴근기록수정요청') summary = (r.content.recordId || '') + ' ' + (r.content.clockIn || '') + '~' + (r.content.clockOut || '');

    html += '<tr><td style="font-size:12px;">' + r.requestedAt + '</td>';
    html += '<td>' + r.employeeName + '</td>';
    html += '<td><span style="font-size:12px;padding:2px 8px;border-radius:10px;background:var(--gray-100);">' + typeLabel + '</span></td>';
    html += '<td style="font-size:12px;">' + summary + '</td>';
    html += '<td>' + statusBadge + '</td>';
    if (isManager()) {
      html += '<td>';
      if (r.status === '대기') {
        html += '<button class="btn btn-sm btn-primary" style="margin-right:4px;" onclick="approveRequestAction(\'' + r.id + '\')"><i class="fas fa-check"></i></button>';
        html += '<button class="btn btn-sm btn-outline" onclick="rejectRequestAction(\'' + r.id + '\')"><i class="fas fa-times"></i></button>';
      } else {
        html += '<span style="font-size:12px;color:var(--gray-500);">' + (r.processedBy || '') + '</span>';
      }
      html += '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function openRequestModal() {
  document.getElementById('reqType').value = '';
  document.getElementById('reqFieldsSchedule').style.display = 'none';
  document.getElementById('reqFieldsLeave').style.display = 'none';
  document.getElementById('reqFieldsAttendance').style.display = 'none';

  // 휴가유형 옵션 채우기
  var sel = document.getElementById('reqLeaveType');
  sel.innerHTML = '<option value="">선택</option>';
  for (var i = 0; i < leaveTypes.length; i++) {
    sel.innerHTML += '<option value="' + leaveTypes[i] + '">' + leaveTypes[i] + '</option>';
  }

  document.getElementById('requestModal').classList.add('active');
}

function closeRequestModal() {
  document.getElementById('requestModal').classList.remove('active');
}

function toggleRequestFields() {
  var type = document.getElementById('reqType').value;
  document.getElementById('reqFieldsSchedule').style.display = type === '근무일정생성요청' ? '' : 'none';
  document.getElementById('reqFieldsLeave').style.display = type === '휴가생성요청' ? '' : 'none';
  document.getElementById('reqFieldsAttendance').style.display = type === '출퇴근기록수정요청' ? '' : 'none';
}

function submitRequestForm() {
  var type = document.getElementById('reqType').value;
  if (!type) { showToast('요청 유형을 선택해주세요.', 'warning'); return; }

  var content = {};
  if (type === '근무일정생성요청') {
    content = {
      date: document.getElementById('reqSchedDate').value,
      startTime: document.getElementById('reqSchedStart').value,
      endTime: document.getElementById('reqSchedEnd').value,
      template: document.getElementById('reqSchedTemplate').value,
      note: document.getElementById('reqSchedNote').value
    };
    if (!content.date) { showToast('날짜를 입력해주세요.', 'warning'); return; }
  } else if (type === '휴가생성요청') {
    content = {
      leaveType: document.getElementById('reqLeaveType').value,
      startDate: document.getElementById('reqLeaveStart').value,
      endDate: document.getElementById('reqLeaveEnd').value,
      reason: document.getElementById('reqLeaveReason').value
    };
    if (!content.leaveType || !content.startDate || !content.endDate) { showToast('필수 항목을 입력해주세요.', 'warning'); return; }
  } else if (type === '출퇴근기록수정요청') {
    content = {
      recordId: document.getElementById('reqAttRecordId').value,
      date: document.getElementById('reqAttDate').value,
      clockIn: document.getElementById('reqAttClockIn').value,
      clockOut: document.getElementById('reqAttClockOut').value,
      reason: document.getElementById('reqAttReason').value
    };
    if (!content.recordId) { showToast('기록ID를 입력해주세요.', 'warning'); return; }
  }

  showLoading();
  google.script.run
    .withSuccessHandler(function(r) {
      hideLoading();
      if (r.success) { closeRequestModal(); loadRequests(); showToast(r.message, 'success'); }
      else showToast(r.message, 'error');
    })
    .withFailureHandler(errHandler)
    .submitRequest({ requestType: type, content: content });
}

function approveRequestAction(id) {
  if (!confirm('이 요청을 승인하시겠습니까?')) return;
  showLoading();
  google.script.run
    .withSuccessHandler(function(r) { hideLoading(); if (r.success) { loadRequests(); showToast(r.message, 'success'); } else showToast(r.message, 'error'); })
    .withFailureHandler(errHandler)
    .approveRequest(id);
}

function rejectRequestAction(id) {
  var reason = prompt('반려 사유를 입력해주세요:');
  if (reason === null) return;
  showLoading();
  google.script.run
    .withSuccessHandler(function(r) { hideLoading(); if (r.success) { loadRequests(); showToast(r.message, 'success'); } else showToast(r.message, 'error'); })
    .withFailureHandler(errHandler)
    .rejectRequest(id, reason);
}

// ============ 스케줄 게시 ============

function publishSelectedSchedules() {
  var ids = getSelectedScheduleIds_();
  if (ids.length === 0) { showToast('게시할 일정을 선택해주세요.', 'warning'); return; }
  showLoading();
  google.script.run
    .withSuccessHandler(function(r) { hideLoading(); if (r.success) { loadScheduleList(); showToast(r.message, 'success'); } else showToast(r.message, 'error'); })
    .withFailureHandler(errHandler)
    .publishSchedule(ids);
}

function unpublishSelectedSchedules() {
  var ids = getSelectedScheduleIds_();
  if (ids.length === 0) { showToast('미게시할 일정을 선택해주세요.', 'warning'); return; }
  showLoading();
  google.script.run
    .withSuccessHandler(function(r) { hideLoading(); if (r.success) { loadScheduleList(); showToast(r.message, 'success'); } else showToast(r.message, 'error'); })
    .withFailureHandler(errHandler)
    .unpublishSchedule(ids);
}

function toggleAllScheduleSelect(cb) {
  var boxes = document.querySelectorAll('.sched-select-cb');
  for (var i = 0; i < boxes.length; i++) boxes[i].checked = cb.checked;
}

function getSelectedScheduleIds_() {
  var boxes = document.querySelectorAll('.sched-select-cb:checked');
  var ids = [];
  for (var i = 0; i < boxes.length; i++) ids.push(boxes[i].value);
  return ids;
}

// ============ 스케줄 복사 ============

function openCopyScheduleModal() {
  var today = new Date();
  var dayOfWeek = today.getDay();
  var mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  var thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() + mondayOffset);
  var nextMonday = new Date(thisMonday);
  nextMonday.setDate(thisMonday.getDate() + 7);

  document.getElementById('copySchedSource').value = formatDateInput_(thisMonday);
  document.getElementById('copySchedTarget').value = formatDateInput_(nextMonday);
  document.getElementById('copyScheduleModal').classList.add('active');
}

function closeCopyScheduleModal() {
  document.getElementById('copyScheduleModal').classList.remove('active');
}

function formatDateInput_(d) {
  var yyyy = d.getFullYear();
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

function submitCopySchedule() {
  var source = document.getElementById('copySchedSource').value;
  var target = document.getElementById('copySchedTarget').value;
  if (!source || !target) { showToast('원본 주와 대상 주를 선택해주세요.', 'warning'); return; }
  if (source === target) { showToast('원본과 대상이 같을 수 없습니다.', 'warning'); return; }

  // 선택한 날짜를 해당 주 월요일로 보정
  var srcDate = new Date(source);
  var srcDay = srcDate.getDay();
  if (srcDay !== 1) srcDate.setDate(srcDate.getDate() - (srcDay === 0 ? 6 : srcDay - 1));
  var tgtDate = new Date(target);
  var tgtDay = tgtDate.getDay();
  if (tgtDay !== 1) tgtDate.setDate(tgtDate.getDate() - (tgtDay === 0 ? 6 : tgtDay - 1));

  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        closeCopyScheduleModal();
        loadSchedule();
        loadScheduleList();
        showToast(result.message, 'success');
      } else {
        showToast(result.message, 'error');
      }
    })
    .withFailureHandler(errHandler)
    .copyWeekSchedule({
      sourceWeekStart: formatDateInput_(srcDate),
      targetWeekStart: formatDateInput_(tgtDate)
    });
}

// ============ 급여명세서 ============

function viewPayslip(payrollId) {
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        renderPayslipContent(result.data);
        document.getElementById('payslipModal').classList.add('active');
      } else { showToast(result.message, 'error'); }
    })
    .withFailureHandler(errHandler)
    .generatePayslip(payrollId);
}

function renderPayslipContent(data) {
  var p = data.payroll;
  var emp = data.employee;
  var details = data.dailyDetails;

  var html = '<div id="payslipPrintArea" style="padding:32px;font-family:\'Noto Sans KR\',sans-serif;">';

  // 헤더
  html += '<div style="text-align:center;border-bottom:3px double var(--gray-900);padding-bottom:16px;margin-bottom:20px;">';
  html += '<h2 style="font-size:22px;margin-bottom:4px;">급 여 명 세 서</h2>';
  html += '<div style="font-size:13px;color:var(--gray-600);">지수회계법인</div>';
  html += '</div>';

  // 직원 정보
  html += '<table style="width:100%;border-collapse:collapse;margin-bottom:20px;">';
  html += '<tr><td style="width:20%;font-weight:bold;padding:6px;border:1px solid var(--gray-300);background:var(--gray-50);">성명</td>';
  html += '<td style="width:30%;padding:6px;border:1px solid var(--gray-300);">' + (emp ? emp.name : p.employeeName) + '</td>';
  html += '<td style="width:20%;font-weight:bold;padding:6px;border:1px solid var(--gray-300);background:var(--gray-50);">정산기간</td>';
  html += '<td style="width:30%;padding:6px;border:1px solid var(--gray-300);">' + p.period + '</td></tr>';
  html += '<tr><td style="font-weight:bold;padding:6px;border:1px solid var(--gray-300);background:var(--gray-50);">조직</td>';
  html += '<td style="padding:6px;border:1px solid var(--gray-300);">' + (p.org || '') + '</td>';
  html += '<td style="font-weight:bold;padding:6px;border:1px solid var(--gray-300);background:var(--gray-50);">시급</td>';
  html += '<td style="padding:6px;border:1px solid var(--gray-300);">' + (emp ? emp.hourlyWage.toLocaleString() : '11,000') + '원</td></tr>';
  html += '</table>';

  // 지급 내역
  html += '<h4 style="margin-bottom:8px;font-size:14px;">지급 내역</h4>';
  html += '<table style="width:100%;border-collapse:collapse;margin-bottom:20px;">';
  html += '<tr style="background:var(--gray-100);"><td style="padding:8px;border:1px solid var(--gray-300);font-weight:bold;">항목</td>';
  html += '<td style="padding:8px;border:1px solid var(--gray-300);text-align:right;font-weight:bold;">금액</td></tr>';

  var items = [
    ['기본급여', p.basePay], ['연장근로수당', p.overtimePay], ['야간근로수당', p.nightPay],
    ['휴일근로수당', p.holidayPay], ['주휴수당', p.weeklyHolidayPay]
  ];
  for (var n = 0; n < items.length; n++) {
    if (items[n][1] > 0) {
      html += '<tr><td style="padding:6px;border:1px solid var(--gray-300);">' + items[n][0] + '</td>';
      html += '<td style="padding:6px;border:1px solid var(--gray-300);text-align:right;">' + Math.round(items[n][1]).toLocaleString() + '원</td></tr>';
    }
  }
  html += '<tr style="font-weight:bold;background:var(--info-light);"><td style="padding:8px;border:1px solid var(--gray-300);">총 지급액</td>';
  html += '<td style="padding:8px;border:1px solid var(--gray-300);text-align:right;">' + Math.round(p.totalPay).toLocaleString() + '원</td></tr>';
  if (p.deductions > 0) {
    html += '<tr><td style="padding:6px;border:1px solid var(--gray-300);color:var(--danger);">공제액</td>';
    html += '<td style="padding:6px;border:1px solid var(--gray-300);text-align:right;color:var(--danger);">-' + Math.round(p.deductions).toLocaleString() + '원</td></tr>';
  }
  html += '<tr style="font-weight:bold;background:var(--primary-light);"><td style="padding:8px;border:1px solid var(--gray-300);">실 지급액</td>';
  html += '<td style="padding:8px;border:1px solid var(--gray-300);text-align:right;font-size:16px;">' + Math.round(p.netPay).toLocaleString() + '원</td></tr>';
  html += '</table>';

  // 근무 요약
  html += '<div style="display:flex;gap:16px;margin-bottom:16px;">';
  html += '<div style="flex:1;text-align:center;padding:12px;background:var(--gray-50);border-radius:var(--radius-sm);"><div style="font-size:20px;font-weight:bold;">' + (p.totalWorkDays || 0) + '</div><div style="font-size:12px;color:var(--gray-500);">총근무일</div></div>';
  html += '<div style="flex:1;text-align:center;padding:12px;background:var(--gray-50);border-radius:var(--radius-sm);"><div style="font-size:20px;font-weight:bold;">' + (p.totalWorkHours || 0) + '</div><div style="font-size:12px;color:var(--gray-500);">총근무시간(h)</div></div>';
  html += '</div>';

  // 일별 상세
  if (details.length > 0) {
    html += '<details><summary style="cursor:pointer;font-weight:bold;margin-bottom:8px;font-size:13px;">일별 근무 상세 (' + details.length + '일)</summary>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    html += '<tr style="background:var(--gray-100);"><th style="padding:4px 6px;border:1px solid var(--gray-300);">날짜</th><th>출근</th><th>퇴근</th><th>실근무(h)</th><th>연장(h)</th><th>상태</th></tr>';
    for (var d = 0; d < details.length; d++) {
      var dd = details[d];
      html += '<tr><td style="padding:3px 6px;border:1px solid var(--gray-300);">' + dd.date + '</td>';
      html += '<td style="padding:3px 6px;border:1px solid var(--gray-300);">' + dd.clockIn + '</td>';
      html += '<td style="padding:3px 6px;border:1px solid var(--gray-300);">' + dd.clockOut + '</td>';
      html += '<td style="padding:3px 6px;border:1px solid var(--gray-300);text-align:right;">' + dd.netHours + '</td>';
      html += '<td style="padding:3px 6px;border:1px solid var(--gray-300);text-align:right;">' + dd.overtimeHours + '</td>';
      html += '<td style="padding:3px 6px;border:1px solid var(--gray-300);">' + dd.status + '</td></tr>';
    }
    html += '</table></details>';
  }

  // 푸터
  html += '<div style="margin-top:30px;text-align:center;font-size:11px;color:var(--gray-500);border-top:1px solid var(--gray-300);padding-top:12px;">';
  html += '발급일: ' + new Date().toISOString().substring(0, 10) + ' | 지수회계법인 급여관리시스템</div>';
  html += '</div>';

  document.getElementById('payslipContent').innerHTML = html;
}

function printPayslip() {
  var content = document.getElementById('payslipPrintArea').innerHTML;
  var w = window.open('', '_blank', 'width=800,height=1000');
  w.document.write('<html><head><title>급여명세서</title><style>');
  w.document.write('body{font-family:sans-serif;padding:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px}');
  w.document.write('</style></head><body>' + content + '</body></html>');
  w.document.close();
  w.print();
}

function closePayslipModal() {
  document.getElementById('payslipModal').classList.remove('active');
}

// ============ 내 프로필 ============
function loadProfile() {
  // 현재 로그인한 사용자 정보 찾기
  var myEmp = null;
  for (var i = 0; i < allEmployees.length; i++) {
    if (allEmployees[i].email === userEmail) {
      myEmp = allEmployees[i];
      break;
    }
  }

  document.getElementById('profileName').value = userName || '';
  document.getElementById('profileEmail').value = userEmail || '';
  document.getElementById('profileRole').value = userRole || '';

  if (myEmp) {
    document.getElementById('profilePhone').value = myEmp.phone || '';
    document.getElementById('profileOrg').value = myEmp.org || '-';
    document.getElementById('profileDuty').value = myEmp.duty || '-';
    document.getElementById('profileJoinDate').value = myEmp.joinDate || '-';
    document.getElementById('profileWage').value = formatNumber(myEmp.hourlyWage) + '원';
    document.getElementById('profileLeave').value = myEmp.annualLeave + '일';
    document.getElementById('profileStatus').value = myEmp.status || '-';
  } else {
    document.getElementById('profilePhone').value = '';
    document.getElementById('profileOrg').value = userOrg || '-';
    document.getElementById('profileDuty').value = '-';
    document.getElementById('profileJoinDate').value = '-';
    document.getElementById('profileWage').value = '-';
    document.getElementById('profileLeave').value = '-';
    document.getElementById('profileStatus').value = '-';
  }
}

function saveProfile() {
  var phone = document.getElementById('profilePhone').value.trim();
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) {
        showToast(result.message, 'success');
        // 로컬 캐시 업데이트
        for (var i = 0; i < allEmployees.length; i++) {
          if (allEmployees[i].email === userEmail) {
            allEmployees[i].phone = phone;
            break;
          }
        }
      } else {
        showToast(result.message, 'error');
      }
    })
    .withFailureHandler(errHandler)
    .updateMyProfile({ phone: phone });
}

// ============ UI 유틸 ============
function showLoading() {
  document.getElementById('loadingOverlay').classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden');
}

function showToast(message, type) {
  type = type || 'info';
  var icons = { success: 'check-circle', error: 'exclamation-circle', warning: 'exclamation-triangle', info: 'info-circle' };
  var container = document.getElementById('toastContainer');
  var toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.innerHTML = '<i class="fas fa-' + (icons[type] || 'info-circle') + '"></i> ' + message;
  container.appendChild(toast);
  setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(function() { toast.remove(); }, 300);
  }, 3500);
}

function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return Number(num).toLocaleString();
}

function errHandler(err) {
  hideLoading();
  showToast('서버 오류: ' + (err.message || err), 'error');
}