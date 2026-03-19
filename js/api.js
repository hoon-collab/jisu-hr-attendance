// ============ google.script.run 호환 래퍼 ============
// 기존 코드의 google.script.run.withSuccessHandler(...).함수명(params)
// 패턴을 그대로 유지하면서 fetch API로 교체합니다.

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

  // 외부 (GitHub Pages)에서 실행 중 — fetch 래퍼로 교체
  function callGasApi(funcName, params) {
    var payload = JSON.stringify({
      action: funcName,
      token: getAccessToken(),
      params: params || null
    });

    // GAS doPost는 302 리다이렉트를 반환 → fetch의 redirect:'follow'는
    // POST→GET으로 바꿔서 body를 잃어버림.
    // 해결: URL 쿼리 파라미터로 payload를 base64 인코딩해서 doGet으로 전달하거나
    // XMLHttpRequest를 사용 (XHR은 POST 리다이렉트에서도 body 유지)
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', CONFIG.GAS_API_URL, true);
      xhr.setRequestHeader('Content-Type', 'text/plain');
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var result = JSON.parse(xhr.responseText);
            resolve(result);
          } catch (e) {
            reject(new Error('응답 파싱 실패: ' + xhr.responseText.substring(0, 100)));
          }
        } else {
          reject(new Error('서버 응답 오류: ' + xhr.status));
        }
      };
      xhr.onerror = function() {
        reject(new Error('네트워크 오류'));
      };
      xhr.ontimeout = function() {
        reject(new Error('요청 시간 초과'));
      };
      xhr.timeout = 60000; // 60초 (GAS 실행 시간 고려)
      xhr.send(payload);
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
