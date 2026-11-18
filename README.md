# 쉿! 케르베로스 · SHH! CERBERUS

잠든 케르베로스의 동굴에서 보석을 모아 입구로 귀환하는 강화학습 실험입니다. 직접 탐험하거나, Double DQN이 같은 규칙에서 학습하는 과정을 관찰할 수 있습니다.

## Windows PowerShell 실행

Python 3.11과 Node.js 24가 필요합니다. 저장소를 복제한 뒤 루트에서 실행합니다. Windows의 긴 경로에서도 PyTorch를 설치할 수 있도록 가상 환경은 짧은 임시 경로를 사용합니다.

```powershell
git clone https://github.com/intellig2nc2/StealTheTreasure.git
Set-Location StealTheTreasure
$cerberusVenv = Join-Path $env:TEMP 'cerberus-rl-py311'
py -3.11 -m venv $cerberusVenv
$cerberusPython = Join-Path $cerberusVenv 'Scripts/python.exe'
& $cerberusPython -m pip install -r backend/requirements.txt
& $cerberusPython -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

별도 PowerShell에서 저장소 루트로 이동한 뒤 실행합니다.

```powershell
Set-Location frontend
npm ci
npm run dev
```

브라우저에서 Vite가 표시한 주소(기본 `http://127.0.0.1:5173`)를 엽니다. Vite는 HTTP와 WebSocket의 `/api` 요청을 포트 8000으로 전달합니다. 별도의 주소에서 프런트엔드를 제공하려면 빌드 전에 `VITE_API_URL`에 API의 전체 원본 주소를 지정하고, 백엔드에서 `CERBERUS_ORIGINS`에 허용할 프런트엔드 원본 주소를 쉼표로 구분해 설정합니다.

CUDA를 쓰려면 해당 가상 환경의 CPU PyTorch 대신 로컬 드라이버와 호환되는 PyTorch CUDA 패키지를 설치합니다. 서버가 CUDA를 감지하면 학습 설정에서 선택할 수 있습니다.

## 탐험과 학습

- **직접 플레이**에서 방향키 또는 WASD로 이동하고 E 또는 Space로 현재 칸의 보석을 수집합니다. 지도 시드를 비워 두면 고정 지도가 열립니다.
- **학습 설정**에서 처음에는 에피소드 수를 10~30회로 직접 입력해 연결과 동작을 확인할 수 있습니다. 기본 학습은 첫 에피소드부터 20×20 전체 동굴(Stage 4)에서 진행됩니다. 작은 지도부터 시작하려면 시드 및 고급 옵션에서 **쉬운 지도부터 단계별 학습**을 켜세요. 실험마다 학습 시드와 평가 시드를 지정하세요.
- **AI 관찰**의 배속은 화면에만 적용됩니다. 학습은 별도 스레드에서 실행됩니다. 1×는 한 행동씩 재생하고, 50×는 화면 갱신을 묶고, MAX는 진행률과 통계만 수신합니다. 서버는 최신 훈련 장면을 전달하므로 느린 배속으로 관찰할 때 일부 에피소드를 건너뜁니다.
- **학습 통계**에서 실제 학습 결과와 Stage 4 평가를 확인할 수 있습니다. 평가는 ε=0이며, 랜덤 학습과 겹치지 않는 별도의 고정된 시드 범위를 사용합니다. 초기·중기·후기와 평가의 대표 에피소드를 다시 볼 수 있습니다.
- 체크포인트는 `backend/models/latest.pt`에 학습 종료 또는 중단 시 저장됩니다. **저장 모델 불러오기**는 모델, 대상 네트워크, Adam 상태와 업데이트 횟수를 새 실행에 사용합니다. 리플레이 버퍼, 난수 상태와 이전 그래프까지 복원하는 기능은 포함하지 않습니다.

### 게임 규칙

보석의 가치, 무게(kg), 수집 소음은 에메랄드 10/1/2, 사파이어 30/3/5, 루비 60/5/10, 전설의 보석 120/8/18입니다. 탈출 성공 시에만 보석 가치를 정산합니다. 보석을 수집한 뒤 입구에 돌아오면 자동 탈출합니다.

이동 기본 비용과 임계값을 먼저 처리한 뒤 살아 있으면 진입 타일의 효과를 적용합니다. 포털은 한 번 이동하며 출발·도착 칸이 지도에서 연결되어 있습니다. 수집으로 무게가 12kg을 넘으면 압사합니다. 소음과 체력이 동시에 한계에 도달하면 케르베로스 각성을 우선 기록합니다.

학습의 행동 공간은 상하좌우와 수집 총 5개입니다. 탐험, 탐욕적 선택, Double DQN의 다음 행동 계산에 모두 마스크가 적용됩니다. 죽거나 탈출하면 부트스트랩하지 않고, 200행동의 시간 제한으로 잘린 전이는 다음 상태를 기준으로 부트스트랩합니다. Stage 1~2의 작은 동굴도 20×20으로 패딩합니다. Stage 3에서 체력과 소음을 활성화하고 Stage 4에서 전체 동굴을 사용합니다.

## Sites와 브라우저 실행

Sites용 빌드는 FastAPI 없이 실행됩니다. 게임과 Double DQN을 탭의 Web Worker에서 실행하므로 팀원마다 플레이와 학습 세션이 분리됩니다. 화면의 배속은 학습 계산에 영향을 주지 않습니다. 브라우저에서는 첫 실행의 기본 학습량이 1,000회이며, 에피소드 수를 직접 입력할 수 있습니다.

```powershell
npm --prefix frontend ci
npm --prefix frontend run build:sites
npm --prefix frontend run preview
```

브라우저 모델은 학습 완료 또는 정상 중단 시 IndexedDB에 저장합니다. 같은 기기·브라우저 프로필에서 같은 사이트를 다시 열면 **저장 모델 불러오기**를 사용할 수 있습니다. 완료된 학습 에피소드는 **학습 기록** 탭에 실행별로 저장되며, 새로고침 뒤에도 확인할 수 있습니다. 통계 그래프와 대표 리플레이는 현재 탭에 남으며 새로고침 시 초기화됩니다.

브라우저의 TensorFlow.js 모델은 타일 유형별로 요약한 20×20 지도와 체력·소음·무게 등의 상태를 사용하는 신경망입니다. 브라우저 체크포인트는 Docker의 PyTorch 체크포인트와 호환되지 않습니다. 모델을 불러올 때 네트워크 가중치와 업데이트 횟수를 복원하고 Adam 상태는 새로 시작합니다.

## 테스트와 배포

```powershell
# 저장소 루트
$cerberusPython = Join-Path $env:TEMP 'cerberus-rl-py311/Scripts/python.exe'
& $cerberusPython -m pip install pytest httpx
& $cerberusPython -m pytest backend/tests
npm --prefix frontend ci
npm --prefix frontend run build
```

Vite 빌드 후 같은 FastAPI 명령으로 `http://127.0.0.1:8000`에서 페이지, API, WebSocket을 함께 제공할 수 있습니다. FastAPI는 시작 시 빌드 디렉터리를 확인합니다.

배포 플랫폼에서 저장소 루트의 Dockerfile로 이미지 하나를 빌드합니다. 호스트는 `PORT`를 제공하거나 기본 포트 8000을 사용합니다. 헬스 체크는 `/api/health`입니다.

```powershell
docker build -t shh-cerberus .
docker volume create cerberus-models
docker run --rm -p 127.0.0.1:8000:8000 --mount source=cerberus-models,target=/app/backend/models shh-cerberus
```

백엔드 인스턴스 하나가 학습 작업과 진행 상태를 공유하며 직접 플레이는 WebSocket 연결별로 분리됩니다. 따라서 워커는 하나로 유지하고, 여러 사용자가 접속하는 배포에서는 플랫폼의 접근 제어로 학습 제어 화면을 보호하세요. 모델 보존을 위해 `/app/backend/models`에 쓰기 가능한 볼륨을 연결합니다. 재시작하면 진행 그래프와 대표 리플레이는 메모리에서 사라집니다.

GitHub Pages는 Vite의 정적 파일을 제공할 수 있지만 FastAPI/PyTorch 실행에는 WebSocket을 지원하는 별도 서버가 필요합니다. 한 주소에서 전부 실행하려면 위 Docker 구성을 사용합니다.
