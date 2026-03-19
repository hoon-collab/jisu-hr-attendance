// ============ Google OAuth 인증 ============
var _accessToken = null;
var _tokenExpiry = 0;
var _tokenClient = null;
var _authResolve = null;
var _authReject = null;

function initGoogleAuth() {
  return new Promise(function(resolve, reject) {
    if (typeof google === 'undefined' || !google.accounts) {
      reject(new Error('Google Identity Services SDK 로드 실패'));
      return;
    }

    _authResolve = resolve;
    _authReject = reject;

    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: 'email profile',
      hosted_domain: CONFIG.ALLOWED_DOMAIN,
      callback: handleAuthResponse_
    });

    // 자동 로그인 시도 (이미 세션 있으면)
    try {
      _tokenClient.requestAccessToken({ prompt: '' });
    } catch (e) {
      // 자동 로그인 실패 → 로그인 화면 표시
      showLoginScreen_();
    }

    // 2초 후에도 응답 없으면 로그인 화면 표시
    setTimeout(function() {
      if (!_accessToken) {
        showLoginScreen_();
      }
    }, 2000);
  });
}

function handleAuthResponse_(response) {
  if (response.error) {
    // 자동 로그인 실패 → 로그인 화면 표시
    if (response.error === 'user_logged_out' || response.error === 'access_denied' || response.error === 'popup_closed_by_user') {
      showLoginScreen_();
      return;
    }
    if (_authReject) _authReject(new Error('로그인 실패: ' + response.error));
    return;
  }

  _accessToken = response.access_token;
  _tokenExpiry = Date.now() + (response.expires_in * 1000) - 60000;

  // 로그인 화면 숨기기
  var loginScreen = document.getElementById('loginScreen');
  if (loginScreen) loginScreen.style.display = 'none';
  var mainContent = document.getElementById('mainContent');
  if (mainContent) mainContent.style.display = '';
  var sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.style.display = '';

  // 사용자 정보 가져오기
  fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { 'Authorization': 'Bearer ' + _accessToken }
  })
  .then(function(r) { return r.json(); })
  .then(function(info) {
    userEmail = info.email || '';
    userName = info.name || info.email.split('@')[0];

    // 도메인 체크
    if (CONFIG.ALLOWED_DOMAIN && userEmail.indexOf('@' + CONFIG.ALLOWED_DOMAIN) === -1) {
      _accessToken = null;
      showLoginScreen_('허용되지 않은 도메인입니다. @' + CONFIG.ALLOWED_DOMAIN + ' 계정으로 로그인해주세요.');
      if (_authReject) _authReject(new Error('도메인 불일치'));
      return;
    }

    // 토큰 자동 갱신 (50분)
    setInterval(function() {
      if (_accessToken && Date.now() > _tokenExpiry && _tokenClient) {
        _tokenClient.requestAccessToken({ prompt: '' });
      }
    }, 3000000);

    if (_authResolve) _authResolve(info);
  })
  .catch(function(err) {
    if (_authReject) _authReject(err);
  });
}

function showLoginScreen_(message) {
  var loginScreen = document.getElementById('loginScreen');
  if (!loginScreen) return;
  loginScreen.style.display = 'flex';

  // 메인 컨텐츠 숨기기
  var mainContent = document.getElementById('mainContent');
  if (mainContent) mainContent.style.display = 'none';
  var sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.style.display = 'none';

  // 로딩 오버레이 숨기기
  var loading = document.getElementById('loadingOverlay');
  if (loading) loading.style.display = 'none';

  if (message) {
    var msgEl = document.getElementById('loginMessage');
    if (msgEl) msgEl.textContent = message;
  }
}

function handleLoginClick() {
  if (_tokenClient) {
    _tokenClient.requestAccessToken({ prompt: 'consent' });
  }
}

function getAccessToken() {
  return _accessToken;
}
