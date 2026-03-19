// ============ Google OAuth 인증 ============
var _accessToken = null;
var _tokenExpiry = 0;

function initGoogleAuth() {
  return new Promise(function(resolve, reject) {
    // Google Identity Services SDK
    if (typeof google === 'undefined' || !google.accounts) {
      reject(new Error('Google Identity Services SDK 로드 실패'));
      return;
    }

    var client = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: 'email profile',
      hosted_domain: CONFIG.ALLOWED_DOMAIN,
      callback: function(response) {
        if (response.error) {
          reject(new Error('로그인 실패: ' + response.error));
          return;
        }
        _accessToken = response.access_token;
        _tokenExpiry = Date.now() + (response.expires_in * 1000) - 60000; // 1분 여유

        // 사용자 정보 가져오기
        fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { 'Authorization': 'Bearer ' + _accessToken }
        })
        .then(function(r) { return r.json(); })
        .then(function(info) {
          userEmail = info.email || '';
          userName = info.name || info.email.split('@')[0];
          resolve(info);
        })
        .catch(reject);
      }
    });

    // 자동 로그인 시도 (이미 세션 있으면)
    client.requestAccessToken({ prompt: '' });

    // 50분마다 토큰 자동 갱신
    setInterval(function() {
      if (_accessToken && Date.now() > _tokenExpiry) {
        client.requestAccessToken({ prompt: '' });
      }
    }, 3000000); // 50분
  });
}

function getAccessToken() {
  return _accessToken;
}
