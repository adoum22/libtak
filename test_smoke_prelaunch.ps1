param(
    [string]$ApiUrl = "http://127.0.0.1:8000/api",
    [string]$Username = "admin",
    [string]$Password,
    [switch]$RunSaleTest
)

$ErrorActionPreference = "Stop"

function Assert-Ok($Condition, $Message) {
    if (-not $Condition) {
        throw $Message
    }
    Write-Host "OK  $Message" -ForegroundColor Green
}

function Invoke-Api($Method, $Path, $Token, $Body = $null) {
    $headers = @{}
    if ($Token) {
        $headers.Authorization = "Bearer $Token"
    }

    $uri = "$ApiUrl$Path"
    if ($Body -ne $null) {
        $json = $Body | ConvertTo-Json -Depth 8
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -Body $json -ContentType "application/json"
    }

    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
}

if (-not $Password) {
    $secure = Read-Host "Mot de passe $Username" -AsSecureString
    $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    )
}

Write-Host "Libtak smoke test: $ApiUrl" -ForegroundColor Cyan

$health = Invoke-RestMethod -Method Get -Uri "$ApiUrl/health/"
Assert-Ok ($health.status -eq "healthy") "API health"

$login = Invoke-Api Post "/auth/login/" $null @{ username = $Username; password = $Password }
$token = $login.access
Assert-Ok ($token) "Connexion admin"

$me = Invoke-Api Get "/auth/me/" $token
Assert-Ok ($me.username) "Profil utilisateur"

$version = Invoke-Api Get "/auth/version/" $token
Assert-Ok ($version.backend_commit_short -or $version.debug -ne $null) "Version backend disponible"

$products = Invoke-Api Get "/inventory/products/" $token
$productList = if ($products.results) { $products.results } else { $products }
Assert-Ok ($productList.Count -ge 0) "Liste produits"

$stockCount = Invoke-Api Get "/inventory/stock-counts/" $token
Assert-Ok ($stockCount -ne $null) "Inventaire accessible"

$orders = Invoke-Api Get "/inventory/purchase-orders/" $token
Assert-Ok ($orders -ne $null) "Commandes fournisseurs accessibles"

$cash = Invoke-Api Get "/accounting/cash-register/" $token
Assert-Ok ($cash.balance -ne $null) "Caisse accessible"

$today = (Get-Date).ToString("yyyy-MM-dd")
$period = Invoke-Api Get "/accounting/period-summary/?type=day&date=$today" $token
Assert-Ok ($period.sales_margin_detail -ne $null) "Comptabilite quotidienne + detail marges"

$diag = Invoke-Api Get "/reporting/logs/diagnose/" $token
Assert-Ok ($diag.smtp_config -ne $null) "Diagnostic email"

if ($RunSaleTest) {
    $saleProduct = $productList | Where-Object { $_.active -ne $false -and $_.stock -gt 0 } | Select-Object -First 1
    Assert-Ok ($saleProduct -ne $null) "Produit disponible pour vente test"
    $sale = Invoke-Api Post "/sales/sales/" $token @{
        items = @(@{ product = $saleProduct.id; quantity = 1 })
        payment_method = "CASH"
    }
    Assert-Ok ($sale.id -ne $null) "Vente test creee (attention: stock diminue)"
}

Write-Host ""
Write-Host "Smoke test termine." -ForegroundColor Green
