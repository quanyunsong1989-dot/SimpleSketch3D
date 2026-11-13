# SimpleSketch 3D 설치: 빌드 결과를 내 PC 프로그램 폴더로 복사하고 바로가기·.s3d 연결을 만든다 (관리자 권한 필요 없음)
# 사용: node build.js 다음에 powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = 'Stop'
$src = Join-Path $env:TEMP 'sketch3d-build\SimpleSketch3D'
$dst = Join-Path $env:LOCALAPPDATA 'Programs\SimpleSketch 3D'
if (-not (Test-Path (Join-Path $src 'SimpleSketch3D.exe'))) { throw "빌드가 없어: $src (먼저 node build.js)" }
if (Get-Process SimpleSketch3D -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$dst*" }) { throw 'SimpleSketch 3D가 켜져 있어. 저장하고 끈 뒤 다시 실행해 (강제로 끄지 않음)' }
# 예전 이름(스케치3D, 1.4까지)으로 깐 것 치우기: 프로그램 폴더·바로가기·.s3d 연결 이름
$old = Join-Path $env:LOCALAPPDATA 'Programs\스케치3D'
if (Get-Process Sketch3D -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$old*" }) { throw '예전 스케치3D가 켜져 있어. 저장하고 끈 뒤 다시 실행해' }
if (Test-Path $old) { Remove-Item $old -Recurse -Force }
foreach ($l in @((Join-Path ([Environment]::GetFolderPath('Desktop')) '스케치3D.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) '스케치3D.lnk'))) { if (Test-Path $l) { Remove-Item $l -Force } }
if (Test-Path 'HKCU:\Software\Classes\Sketch3D.Model') { Remove-Item 'HKCU:\Software\Classes\Sketch3D.Model' -Recurse -Force }
if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item (Join-Path $src '*') $dst -Recurse -Force
$exe = Join-Path $dst 'SimpleSketch3D.exe'

$ws = New-Object -ComObject WScript.Shell
$desk = [Environment]::GetFolderPath('Desktop')
$start = Join-Path ([Environment]::GetFolderPath('Programs')) 'SimpleSketch 3D.lnk'
foreach ($lnk in @((Join-Path $desk 'SimpleSketch 3D.lnk'), $start)) {
  $s = $ws.CreateShortcut($lnk)
  $s.TargetPath = $exe
  $s.WorkingDirectory = $dst
  $s.IconLocation = "$exe,0"
  $s.Description = 'SimpleSketch 3D - 3D 모델링'
  $s.Save()
}

# .s3d 파일 두 번 클릭 → SimpleSketch 3D
$cls = 'HKCU:\Software\Classes'
New-Item -Path "$cls\.s3d" -Force | Out-Null
Set-ItemProperty -Path "$cls\.s3d" -Name '(default)' -Value 'SimpleSketch3D.Model'
New-Item -Path "$cls\SimpleSketch3D.Model\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path "$cls\SimpleSketch3D.Model" -Name '(default)' -Value 'SimpleSketch 3D 모델'
Set-ItemProperty -Path "$cls\SimpleSketch3D.Model\DefaultIcon" -Name '(default)' -Value "`"$exe`",0"
New-Item -Path "$cls\SimpleSketch3D.Model\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$cls\SimpleSketch3D.Model\shell\open\command" -Name '(default)' -Value "`"$exe`" `"%1`""
Write-Output "설치 끝: $exe"
