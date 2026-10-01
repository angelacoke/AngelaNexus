# AngelaNexus 全项目 GitHub CI 总控
$ErrorActionPreference = "Stop"
$Repo = "dukangalex/AngelaNexus"
$Branch = "main"
$PollSeconds = 10
$MaxAttempts = 5

function Invoke-GhJson {
    param([string]$Endpoint)
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            $raw = gh api $Endpoint 2>&1
            if ($LASTEXITCODE -eq 0) {
                return ($raw | ConvertFrom-Json)
            }
        } catch {
            if ($attempt -ge $MaxAttempts) { throw }
        }
        if ($attempt -lt $MaxAttempts) {
            Write-Host "GitHub API 暂时不可用，等待 ${PollSeconds}s 后重试 ($attempt/$MaxAttempts)..."
            Start-Sleep -Seconds $PollSeconds
        }
    }
    throw "GitHub API 请求失败: $Endpoint"
}

function Get-MainSha {
    $ref = Invoke-GhJson "repos/$Repo/git/ref/heads/$Branch"
    return $ref.object.sha
}

function Get-RunsForSha {
    param([string]$Sha)
    $result = Invoke-GhJson "repos/$Repo/actions/runs?head_sha=$Sha&per_page=100"
    $items = New-Object System.Collections.Generic.List[object]
    foreach ($item in @($result.workflow_runs)) {
        if ($null -eq $item) { continue }
        $idText = [string]$item.id
        $nameText = [string]$item.name
        if ($idText -notmatch '^[0-9]+$') { continue }
        if ([int64]$idText -le 0) { continue }
        if ([string]::IsNullOrWhiteSpace($nameText)) { continue }
        [void]$items.Add($item)
    }
    return @($items.ToArray())
}

function Show-Status {
    param([array]$Runs)
    $rows = foreach ($run in $Runs) {
        [pscustomobject]@{
            Workflow = $run.name
            Run = $run.id
            Status = $run.status
            Result = if ($run.conclusion) { $run.conclusion } else { "-" }
            Attempt = $run.run_attempt
        }
    }
    if ($rows.Count -gt 0) {
        $rows | Sort-Object Workflow | Format-Table -AutoSize | Out-Host
    }
}

function Wait-ForRuns {
    param([string]$Sha)
    while ($true) {
        $currentSha = Get-MainSha
        if ($currentSha -ne $Sha) {
            throw "main 已产生新提交。停止旧 SHA 验证：$Sha -> $currentSha"
        }
        $runs = @(Get-RunsForSha $Sha)
        if ($runs.Count -eq 0) {
            Write-Host "当前 SHA 尚未发现 GitHub Actions，等待 ${PollSeconds}s..."
            Start-Sleep -Seconds $PollSeconds
            continue
        }
        Write-Host ""
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] AngelaNexus 全项目 CI"
        Write-Host "SHA: $Sha"
        Show-Status $runs
        $active = @($runs | Where-Object {
            $_.status -in @("queued","in_progress","waiting","requested","pending")
        })
        if ($active.Count -gt 0) {
            Write-Host "仍有 $($active.Count) 个 Workflow 未完成，等待 ${PollSeconds}s..."
            Start-Sleep -Seconds $PollSeconds
            continue
        }
        return ,$runs
    }
}

function Retry-FailedRuns {
    param([array]$Runs,[hashtable]$Attempts)
    $failed = @($Runs | Where-Object {
        $_.id -and [int64]$_.id -gt 0 -and $_.name -and
        $_.conclusion -notin @("success","skipped","neutral")
    })
    foreach ($run in $failed) {
        $key = [string]$run.id
        if (-not $Attempts.ContainsKey($key)) { $Attempts[$key] = 0 }
        if ($Attempts[$key] -ge $MaxAttempts) { continue }
        $Attempts[$key]++
        Write-Host ""
        Write-Host "失败 Workflow: $($run.name) / Run $($run.id)"
        Write-Host "重试次数: $($Attempts[$key])/$MaxAttempts"
        gh run rerun $run.id --failed --repo $Repo
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "gh run rerun 失败：$($run.id)"
        }
    }
    return ,$failed
}

Write-Host "=========================================="
Write-Host " AngelaNexus 全项目 CI 自动验证"
Write-Host " Repo: $Repo"
Write-Host " Branch: $Branch"
Write-Host "=========================================="

gh --version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "未安装 GitHub CLI。请先安装 gh。" }
gh auth status --hostname github.com
if ($LASTEXITCODE -ne 0) { throw "GitHub CLI 尚未登录。请执行：gh auth login" }

$sha = Get-MainSha
Write-Host "锁定验证 SHA: $sha"
$attempts = @{}

while ($true) {
    $runs = @(Wait-ForRuns $sha)
    $failed = @($runs | Where-Object {
        $_.conclusion -notin @("success","skipped","neutral")
    })
    if ($failed.Count -eq 0) {
        $finalSha = Get-MainSha
        if ($finalSha -ne $sha) {
            throw "最终验证前 main 发生变化：$sha -> $finalSha"
        }
        Write-Host ""
        Write-Host "=========================================="
        Write-Host " ANGELANEXUS 全项目 CI 验证成功"
        Write-Host " SHA: $sha"
        Write-Host "=========================================="
        exit 0
    }

    $retryable = @(Retry-FailedRuns -Runs $runs -Attempts $attempts)
    $exhausted = @($retryable | Where-Object {
        $attempts[[string]$_.id] -ge $MaxAttempts
    })
    if ($exhausted.Count -gt 0) {
        Write-Host ""
        Write-Host "=========================================="
        Write-Host " CI 验证失败：达到最大重试次数"
        Write-Host "=========================================="
        foreach ($run in $exhausted) {
            Write-Host ""
            Write-Host "Workflow: $($run.name)"
            Write-Host "Run: $($run.id)"
            Write-Host "URL: $($run.html_url)"
            gh run view $run.id --repo $Repo --log-failed
        }
        exit 1
    }
    Write-Host "失败 Workflow 已重新执行，等待 ${PollSeconds}s 后重新验证..."
    Start-Sleep -Seconds $PollSeconds
}
