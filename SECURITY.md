# 개인정보 처리와 코드 검토 안내

이 문서는 확인할 코드와 검증 방법을 설명합니다. 독립 보안 감사나 인증을 받았다는 의미는 아닙니다.

## 입력값이 지나가는 경로

| 항목 | 작성된 변환 코드의 처리 |
| --- | --- |
| 붙여넣은 주문 내역 | `dist/parser.mjs`가 읽고 `dist/app.mjs`의 페이지 상태에서 다룹니다. |
| 수취인·주소·연락처·개인통관고유부호 | 화면의 입력칸과 페이지 메모리에 두고 엑셀 생성에 사용합니다. |
| 상품 연결·품목 분류 | `dist/catalog-match.mjs`, `dist/categories.mjs`와 미리 준비한 공개 카탈로그를 사용합니다. |
| 엑셀 다운로드 | `dist/exporter.mjs`가 브라우저 안에서 양식을 채우고, `app.mjs`가 Blob 다운로드를 만듭니다. 파일은 사용자의 기기에 남습니다. |
| 배대지 업로드 | 사용자가 내려받은 엑셀을 배대지에서 직접 업로드하는 별도 단계입니다. |

주문 변환과 엑셀 생성 코드는 입력값을 담아 서버에 전송하거나 `localStorage`, `sessionStorage`, IndexedDB, 쿠키에 저장하는 기능을 사용하지 않습니다. 페이지를 새로 열면 앱의 입력 상태는 초기화됩니다. 기기에 저장한 다운로드 파일은 별도로 남습니다. 아래의 선택적 우편번호 검색은 별도 외부 서비스입니다.

## 선택적 우편번호 검색

HTTP/HTTPS로 실행할 때 **우편번호 찾기** 버튼을 누르면 별도 `postcode-search.html` 검색창이 열립니다. 그 창에서만 [카카오 공식 우편번호 SDK](https://postcode.map.kakao.com/guide)를 불러옵니다. 페이지를 열거나 수취인 정보를 입력하는 것만으로는 검색 서비스에 접속하지 않습니다.

메인 페이지는 외부 SDK를 실행하지 않습니다. 검색창은 `noopener,noreferrer`로 열어 부모창 DOM 참조를 주지 않으며, 임의 토큰 이름의 `BroadcastChannel`로 선택한 5자리 우편번호·기본주소만 받습니다. 수신 시 토큰·메시지 종류·문자열 길이를 검증하고 폼의 값으로 사용합니다. 주문·수취인명·연락처·통관부호·기존 주소·동호수를 검색창에 보내지 않습니다.

`_headers`의 기존 전역 CSP는 유지합니다. 검색 문서의 두 정확한 경로(`/postcode-search.html`, `/postcode-search`)만 독립된 문서 내 CSP를 적용하도록 분리합니다. 해당 CSP는 기본 외부 자원을 차단하고 카카오 공식 SDK·검색 프레임 호스트만 허용합니다. 검색 문서는 `X-Frame-Options: DENY`로 iframe 삽입을 막습니다. 호스팅별 실제 헤더 적용 여부는 별도로 확인해야 합니다.

검색창에 사용자가 직접 입력한 검색어와 서비스 이용에 따른 접속 정보는 카카오에 전달됩니다. 해당 외부 서비스의 기록·보관까지 이 도구가 없다고 보장하지 않습니다. 사용자가 새 기본주소를 선택하면 기존 상세주소를 지우고 다시 입력하도록 합니다. 주소 검색을 사용하지 않아도 우편번호와 주소를 직접 입력할 수 있습니다.

파일(`file://`)을 직접 여는 오프라인 모드에서는 검색 버튼을 비활성화하며 외부 SDK를 불러오지 않습니다. 브라우저의 로컬 파일 출처·통신 제약과 SDK의 로컬 경로 전송을 피하기 위한 구분입니다. 오프라인 메인 페이지의 `connect-src 'none'`, `frame-src 'none'` 정책은 유지합니다.

## 실제 파일 입출력

온라인 모드의 데이터 로더는 [dist/data.mjs](dist/data.mjs)입니다. 허용된 이름만 받아 같은 사이트의 아래 경로를 읽습니다.

- `./general-config.json`, `./fast-config.json`, `./postmall-config.json`, `./catalog.json`, `./thumbnails.json`
- `./templates/jimpass.xlsx`, `./templates/general.xlsx`, `./templates/hoottown-fast.xlsx`, `./templates/postmall.xlsx`

이 요청에 주문·수취인 입력값을 URL이나 본문으로 붙이지 않습니다. 상품·이미지 주소는 공개 카탈로그의 문자열로 연결하며 원격 상품 이미지를 자동으로 불러오지 않습니다. 사용자가 상품 링크를 직접 누르면 해당 외부 사이트로 이동합니다.

상품 카드와 후보 목록의 썸네일은 공개 카탈로그 이미지를 준비 단계에서 미리 축소한 `thumbnails.json`을 사용합니다. 화면의 이미지 `src`에는 이 자료의 `data:image/webp` 값만 사용하며 입력한 이미지 URL을 직접 원격 로드하지 않습니다. 온라인에서는 같은 사이트에서 전체 공개 썸네일 자료를 읽고, 오프라인에서는 HTML 안에 포함된 자료를 사용합니다. 주문을 읽거나 상품 후보를 선택한 뒤 이미지 서버에 요청을 보내지 않습니다.

공개 카탈로그와 영어 이름을 갱신하는 Python 스크립트는 준비 과정에서 네트워크를 사용합니다. 공개 상품명만 번역 대상으로 보내며 방문자의 페이지 입력값을 처리하지 않습니다. 이 수집·번역 단계와 방문자가 엑셀을 만드는 실행 경로를 구분해서 검토해야 합니다.

오프라인 모드에서는 `window.__ORDER_EXCEL_OFFLINE__`에 들어 있는 JSON과 네 양식의 Base64 데이터를 읽습니다. 데이터 로더는 이 모드에서 `fetch`를 호출하지 않습니다.

포스트몰 HS 찾기는 사용자가 직접 누르는 외부 링크입니다. 링크에는 주문명·주소·연락처·통관부호를 검색어로 붙이지 않으며, 외부 창은 `noopener noreferrer`로 엽니다. 이 도구에는 포스트몰 검색 스크립트나 광고·통계 코드를 포함하지 않습니다.

포스트몰 HS 자동 제안은 `postmall-hs.mjs`에 포함된 정적 규칙을 현재 페이지에서 실행합니다. 상품명과 이미 포함된 공개 상품 상세 자료만 사용하며, 실시간 HS 검색 API 요청이나 주문 정보 전송을 하지 않습니다. 재질·용도가 확인되지 않는 상품에는 코드를 강제로 채우지 않으며 수동 입력·수동 삭제를 유지합니다.

## 온라인 호스팅과 오프라인 파일의 범위

온라인 사이트에는 정적 소스 외에 호스팅·보안 계층이 있습니다. 현재 배포 응답에서 Cloudflare 봇 탐지 스크립트 삽입을 확인했습니다. 배포의 사용자 지정 `_headers`가 실제 HTTP 응답에 그대로 적용된다고 가정하지 않습니다.

접속 IP·시각·요청 경로 등 호스팅 계층의 접속 기록과 플랫폼 코드의 동작은 이 저장소가 작성한 변환 코드와 별도입니다. 저장소를 읽는 것만으로 이 계층 전체의 처리·보관을 확인했다고 할 수 없습니다.

오프라인 배포는 HTML 응답의 변경을 피하도록 [GitHub의 offline.zip](https://github.com/masudaayano156/asobimall-order-excel/raw/refs/heads/main/downloads/offline.zip)을 사용합니다. ZIP 안에는 빌드한 원본 `order-excel-offline.html`, 사용 안내와 fflate 라이선스가 있습니다. 압축을 푼 HTML은 외부 스크립트·스타일 로더 없이 실행하고 다음 CSP를 포함합니다.

```text
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
connect-src 'none'; img-src data:; font-src 'none'; object-src 'none';
frame-src 'none'; form-action 'none'; base-uri 'none'
```

HTML 안의 데이터와 앱 실행 코드 두 개가 인라인 스크립트로 들어갑니다. 인터넷 연결을 끊은 상태에서도 주문 처리와 엑셀 다운로드가 동작하도록 구성했습니다. 상품 링크를 직접 클릭하는 동작은 별도입니다.

## 파일과 실행 경로 확인

현재 게시 버전의 [checksums.txt](https://github.com/masudaayano156/asobimall-order-excel/raw/refs/heads/main/downloads/checksums.txt)는 `offline.zip`과 `source.zip`의 SHA-256을 기록합니다. 같은 커밋의 downloads 폴더에서 받은 파일끼리 비교하세요. Windows PowerShell에서는 다음처럼 계산할 수 있습니다.

```powershell
Get-FileHash -Algorithm SHA256 .\offline.zip
Get-FileHash -Algorithm SHA256 .\source.zip
```

ZIP 안 `README.txt`에는 내부 HTML의 SHA-256도 있습니다. 해시가 같다는 것은 비교 대상 바이트가 같다는 뜻입니다. 악성 동작이 없다는 보안 인증은 아닙니다.

소스를 별도로 확인하려면 [공개 저장소](https://github.com/masudaayano156/asobimall-order-excel)의 해당 소스 커밋을 내려받아 다음 순서로 빌드·검사합니다.

```sh
npm ci
npm run build:offline
npm test
```

같은 소스 커밋·고정된 의존성·카탈로그를 사용하세요. 재현 비교 중 카탈로그를 갱신하면 입력 데이터가 바뀝니다. 빌드한 ZIP과 게시 ZIP의 해시를 독립적으로 비교하고, 차이가 나면 소스 버전·도구·줄바꿈·파일 내용의 차이를 조사하세요.

현재 테스트에서 확인하는 범위는 다음과 같습니다.

- `tests/offline.test.mjs`: ZIP 내부 HTML의 바이트 일치, 의도한 두 스크립트만 포함, 외부 로더 부재, CSP, 네 양식 포함, 오프라인 로더의 네트워크 미호출, 공개 소스 허용 목록과 ZIP 해시
- `tests/english-orders.test.mjs`: 영어 주문의 상품 연결·품목코드·세 양식 출력과 영어 상품명 유지
- `tests/postmall-export.test.mjs`: 포스트몰 가로 20개 상품 배치·독립 HS 코드·주문 구획·원본 서식과 데이터 보존
- `tests/postmall-hs.test.mjs`: 종류·재질 조건에 맞는 HS 제안과 부품·다른 재질·혼합 구성의 오분류 방지
- `tests/order-shipping.test.mjs`: 훗타운 추후 입력의 ETC 기본값·운송장 공란·원본 수식 코드 35와 운송정보 전환 검증
- `tests/postcode.test.mjs`: 주소 검색 수신 메시지의 토큰·우편번호·주소 검증과 불필요한 값 제외
- 파서·상품 매칭·분류·엑셀 내보내기 테스트: 수량·금액·중복 후보·양식별 열 처리 등

이 테스트는 해당 사례와 구현 경로를 검증합니다. 실제 배포 응답과 브라우저의 네트워크 동작은 개발자 도구에서 별도로 확인할 수 있습니다. 실제 개인정보 대신 재현용 예시를 사용하세요.

## AI에 복사해서 요청할 검토문

아래 요청과 함께 저장소 링크 또는 같은 버전의 소스를 제공할 수 있습니다.

```text
https://github.com/masudaayano156/asobimall-order-excel 을 독립적으로 검토해 주세요.

입력한 주문·수취인 정보가 어디로 흐르는지 실제 호출 경로와 파일·줄 번호를 근거로 설명해 주세요.

1. dist/app.mjs, data.mjs, parser.mjs, exporter.mjs와 import되는 모듈을 따라가 주세요. 선택적 주소 검색은 postcode.mjs와 별도 postcode-search.html의 창 격리·BroadcastChannel 검증을 확인해 주세요.
2. fetch, XMLHttpRequest, sendBeacon, WebSocket, EventSource, 폼 제출, 원격 이미지·스타일·글꼴 로딩을 찾아 목적지·요청 방식·본문과 입력값의 연관성을 확인해 주세요.
3. localStorage, sessionStorage, IndexedDB, 쿠키, URL·히스토리를 통한 입력값 저장·노출도 확인해 주세요.
4. Worker·Service Worker, 동적 import, eval·new Function 등 동적 실행이 실제 실행 경로에 있는지 확인해 주세요. 포함된 라이브러리에서 단어만 발견한 것과 앱에서 호출되는 기능을 구분해 주세요.
5. 공개 카탈로그를 수집·번역하는 준비 스크립트와 방문자의 브라우저 실행 경로를 구분해 주세요.
6. scripts/build-offline.mjs의 포함 파일 목록·인라인 데이터 직렬화·CSP를 검토해 주세요. ZIP 내부 HTML에 외부 로더나 호스팅 삽입 코드가 있는지도 확인해 주세요.
7. 같은 소스 커밋의 downloads 폴더에 게시된 offline.zip·source.zip·checksums.txt를 비교하고, 해당 소스 버전에서 npm ci → npm run build:offline → npm test로 별도 빌드한 결과도 비교해 주세요. 카탈로그를 새로 수집하지 마세요.
8. 저장소에 작성된 코드, 실제 온라인 호스팅 응답, 검토하지 못한 부분을 구분해 주세요.

발견한 문제는 영향·재현 방법·파일과 줄 근거를 제시하고, 확인되지 않은 사항은 확인했다고 표현하지 마세요. 해시 일치나 AI 검토만으로 안전을 보장한다고 결론 내리지 마세요.
```

AI 답변은 검토를 돕는 자료입니다. 답변 자체가 개인정보 보호나 보안을 보장하지 않습니다.

## 문제 제보

일반적인 버그는 [GitHub Issues](https://github.com/masudaayano156/asobimall-order-excel/issues)에 재현용 예시와 함께 남길 수 있습니다. 공개 이슈에는 실제 주문번호·연락처·주소·개인통관고유부호 등 민감한 정보를 올리지 마세요.

사용 중인 fflate 라이브러리의 라이선스는 [dist/fflate-LICENSE.txt](dist/fflate-LICENSE.txt)에 있습니다.
