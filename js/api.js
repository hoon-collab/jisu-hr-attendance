// ============ google.script.run 호환 래퍼 ============
// 기존 코드의 google.script.run.withSuccessHandler(...).함수명(params)
// 패턴을 그대로 유지하면서 외부 API 호출로 교체합니다.

(function() {
  // 원래 google.script.run 백업 (GAS 내부 실행 시 사용)
  var _originalGSR = (typeof google !== 'undefined' && google.script && google.script.run)
    ? google.script.run : null;

  // GAS 내부 실행인지 확인
  var _isInsideGAS = !!_originalGSR;

  if (_isInsideGAS) {
    // GAS 내부에서 실행 중이면 원래 google.script.run 사용 (변경 없음)
    return;
  }

  // 외부 (GitHub Pages)에서 실행 중
  // GAS 웹앱은 doGet만 안정적 (doPost는 302 리다이렉트 시 body 유실)
  // → URL 파라미터로 action/token/params 전달
  function callGasApi(funcName, params) {
    var token = typeof getAccessToken === 'function' ? getAccessToken() : '';
    var url = CONFIG.GAS_API_URL +
      '?api=1' +
      '&action=' + encodeURIComponent(funcName) +
      '&token=' + encodeURIComponent(token);

    if (params !== null && params !== undefined) {
      url += '&params=' + encodeURIComponent(JSON.stringify(params));
    }

    return fetch(url, {
      method: 'GET',
      redirect: 'follow'
    })
    .then(function(resp) {
      if (!resp.ok) throw new Error('서버 응답 오류: ' + resp.status);
      return resp.json();
    });
  }

  // google.script.run 호환 객체
  function createRunChain() {
    var _success = null;
    var _failure = null;

    var chain = {
      withSuccessHandler: function(fn) { _success = fn; return proxy; },
      withFailureHandler: function(fn) { _failure = fn; return proxy; }
    };

    var proxy = new Proxy(chain, {
      get: function(target, prop) {
        if (prop === 'withSuccessHandler' || prop === 'withFailureHandler') {
          return target[prop];
        }
        // 함수명 → API 호출
        return function(params) {
          callGasApi(prop, params)
            .then(function(result) {
              if (_success) _success(result);
            })
            .catch(function(err) {
              if (_failure) _failure(err);
              else console.error('API 오류:', prop, err);
            });
        };
      }
    });

    return proxy;
  }

  // google 네임스페이스 생성
  if (typeof window.google === 'undefined') window.google = {};
  if (!window.google.script) window.google.script = {};
  window.google.script.run = new Proxy({}, {
    get: function(target, prop) {
      if (prop === 'withSuccessHandler') {
        var chain = createRunChain();
        return function(fn) { return chain.withSuccessHandler(fn); };
      }
      if (prop === 'withFailureHandler') {
        var chain2 = createRunChain();
        return function(fn) { return chain2.withFailureHandler(fn); };
      }
      // 직접 함수 호출 (핸들러 없이)
      return function(params) { return callGasApi(prop, params); };
    }
  });
})();
