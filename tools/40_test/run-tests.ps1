# tests/ のテストを node と bun の両方で全件実行する。
$ErrorActionPreference = 'Stop'

# 対象は絶対パスで渡す。省くと node --test がカレント配下を探して、テストでないファイルまで実行する
$testsDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../tests')).Path
if (-not $testsDir) { throw 'tests フォルダが見つかりません' }

Write-Host '=== node --test ==='
node --test $testsDir
$nodeExit = $LASTEXITCODE

$bunExit = 0
if (Get-Command bun -ErrorAction SilentlyContinue) {
	Write-Host '=== bun test ==='
	bun test $testsDir
	$bunExit = $LASTEXITCODE
} else {
	Write-Host 'bun が入っていないため、bun test は飛ばします。'
}

if ($nodeExit -ne 0 -or $bunExit -ne 0) { exit 1 }
exit 0
