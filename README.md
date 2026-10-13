# Murmur 로컬 번역 — 내 컴퓨터에서 도는 이중 언어 번역 크롬 확장

코난쌤 유튜브 핸즈온 영상의 실습 자료예요. 웹페이지와 유튜브 자막을 **원문 + 한국어**로 함께 보여 주는 크롬 확장을 만들고, 번역은 클라우드가 아니라 내 맥에서 도는 [murmur](https://github.com/jkf87/murmur)의 NLLB-200 번역 엔진으로 처리해요.

```
크롬 확장 (웹페이지 문단 / 유튜브 자막)
      │ chrome.runtime.sendMessage
background.js ── fetch ──▶ 로컬 번역 서버 (bridge/server.py, 127.0.0.1:8790)
                                  │
                           murmur.translate (NLLB-200 600M, CTranslate2, CPU)
```

> 영상에서는 기존 번역 확장(Immersive Translate)이 어떤 구조로 동작하는지 REA로 살펴본 뒤, 그 구조를 참고해 **코드를 처음부터 새로 썼어요.** 이 저장소에는 그 확장의 코드나 리소스가 들어 있지 않아요.

## 준비물
- Apple Silicon 또는 Intel 맥, 리눅스도 가능(번역 서버는 CPU로 돌아요)
- Python 3.11 이상, 디스크 약 3GB(번역 모델 2.3GB)
- Chrome 또는 Chromium 계열 브라우저(개발자 모드로 확장 올리기)

## 따라 하기

### 1. 번역 서버 준비하고 켜기
```bash
git clone https://github.com/jkf87/murmur-translate
cd murmur-translate
./setup.sh          # 가상환경 + murmur 코어 + NLLB 모델(약 2.3GB) 받기, 처음 한 번만
./start.sh          # "murmur 번역 서버 준비 완료 → http://127.0.0.1:8790"
```
다른 터미널에서 확인:
```bash
./try-translate.sh "Nothing leaves your computer."
```

### 2. 확장 올리기
1. 크롬 주소창에 `chrome://extensions` 입력
2. 오른쪽 위 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드합니다** → 이 저장소의 `extension` 폴더 선택
4. 툴바의 확장 아이콘을 누르면 "연결됨 · murmur NLLB-200 (local)"이 보여야 해요

### 3. 웹페이지 번역
영어 페이지 오른쪽에 뜬 파란 **번역** 버튼을 누르면, 화면에 보이는 문단부터 원문 아래에 한국어가 붙어요. 스크롤하면 아래 문단도 이어서 번역해요.

### 4. 유튜브 이중 자막
영어 자막이 있는 영상을 열고 자막(CC)을 켜면, 유튜브 기본 자막 대신 **원문(흰색) + 한국어(노란색)** 두 줄 자막이 떠요. 팝업의 "유튜브 이중 자막" 체크로 끄고 켤 수 있어요.

## 어떻게 동작하나
| 파일 | 하는 일 |
|---|---|
| `extension/content/youtube-hook.js` | 유튜브 페이지 안(MAIN world)에서 플레이어가 받아 온 자막 파일(`/api/timedtext`) 응답을 복사해 넘겨요. 요청을 새로 만들지 않아요. |
| `extension/content/youtube.js` | 자막을 줄 단위로 나누고, 지금 재생 위치에 가까운 줄부터 묶어서 번역해 두었다가 영상 시간에 맞춰 띄워요. |
| `extension/content/page.js` | 문단(p, li, h1~h6 …)을 골라 화면에 보이는 것부터, 화면 아래 두 장 분량까지 미리 번역해요. 나중에 생긴 문단도 따라가요. |
| `extension/background.js` | 웹페이지가 아니라 확장만 로컬 서버(127.0.0.1:8790)와 이야기해요. |
| `bridge/server.py` | murmur의 `Translator`로 NLLB 모델을 불러, 여러 문단을 한 번에 묶어 번역하고 결과를 캐시해요. |

## 한계
- NLLB-200 600M은 작은 번역 모델이라 문장이 어색하거나 틀릴 때가 있어요. (예: "Under Artemis" → "아르테미스 주하에")
- CPU에서 문장당 약 0.5초 걸려요. 그래서 유튜브는 앞으로 나올 자막을 미리 번역해 둬요.
- 유튜브 자막이 없는 영상, 라이브 방송은 지원하지 않아요. 소리를 바로 받아쓰려면 murmur 앱의 컴퓨터 오디오 전사 기능을 쓰세요.
- 유튜브 내부 구조(자막 요청 주소, 플레이어 요소 이름)가 바뀌면 동작하지 않을 수 있어요.
- 번역 방향은 영어 → 한국어로 고정했어요(`source`, `target` 값으로 바꿀 수 있어요).

## 출처
[SOURCES.md](SOURCES.md)

## 라이선스
MIT
