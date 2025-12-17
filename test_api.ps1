# 🧪 Script de Test Rapide - API Backend

## Test 1 : Connexion et récupération du token

$body = @{
    username = "admin"
    password = "admin123"
} | ConvertTo-Json

Write-Host "🔐 Test de connexion..." -ForegroundColor Cyan
$response = Invoke-RestMethod -Uri "http://localhost:8000/api/auth/login/" -Method Post -Body $body -ContentType "application/json"
$token = $response.access

Write-Host "✅ Connexion réussie !" -ForegroundColor Green
Write-Host "Token JWT : $($token.Substring(0,50))..." -ForegroundColor Yellow
Write-Host ""

## Test 2 : Récupérer les produits

$headers = @{
    Authorization = "Bearer $token"
}

Write-Host "📦 Récupération des produits..." -ForegroundColor Cyan
$products = Invoke-RestMethod -Uri "http://localhost:8000/api/inventory/products/" -Headers $headers

Write-Host "✅ $($products.Count) produits trouvés !" -ForegroundColor Green
Write-Host ""
Write-Host "Liste des produits :" -ForegroundColor Yellow
$products | Select-Object id, name, barcode, price_ttc, stock | Format-Table -AutoSize

## Test 3 : Recherche par code-barres

Write-Host "🔍 Recherche du livre Harry Potter (code-barres: 9780747532743)..." -ForegroundColor Cyan
$product = Invoke-RestMethod -Uri "http://localhost:8000/api/inventory/products/?barcode=9780747532743" -Headers $headers

if ($product.Count -gt 0) {
    Write-Host "✅ Produit trouvé !" -ForegroundColor Green
    Write-Host "Nom: $($product[0].name)" -ForegroundColor Yellow
    Write-Host "Prix TTC: $($product[0].price_ttc) €" -ForegroundColor Yellow
    Write-Host "Stock: $($product[0].stock)" -ForegroundColor Yellow
} else {
    Write-Host "❌ Produit non trouvé" -ForegroundColor Red
}
Write-Host ""

## Test 4 : Créer une vente

Write-Host "🛒 Création d'une vente test..." -ForegroundColor Cyan
$sale = @{
    items = @(
        @{
            product = $products[0].id
            quantity = 2
        }
    )
    payment_method = "CASH"
} | ConvertTo-Json

try {
    $newSale = Invoke-RestMethod -Uri "http://localhost:8000/api/sales/sales/" -Method Post -Body $sale -Headers $headers -ContentType "application/json"
    Write-Host "✅ Vente créée avec succès !" -ForegroundColor Green
    Write-Host "ID Vente: $($newSale.id)" -ForegroundColor Yellow
    Write-Host "Total HT: $($newSale.total_ht) €" -ForegroundColor Yellow
    Write-Host "TVA: $($newSale.total_tva) €" -ForegroundColor Yellow
    Write-Host "Total TTC: $($newSale.total_ttc) €" -ForegroundColor Yellow
} catch {
    Write-Host "❌ Erreur lors de la création de la vente" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}
Write-Host ""

## Test 5 : Vérifier les statistiques

Write-Host "📊 Récupération des statistiques..." -ForegroundColor Cyan
$stats = Invoke-RestMethod -Uri "http://localhost:8000/api/reporting/stats/" -Headers $headers

Write-Host "✅ Statistiques récupérées !" -ForegroundColor Green
Write-Host ""
Write-Host "Top 5 des produits les plus vendus :" -ForegroundColor Yellow
$stats.top_products | Select-Object product__name, total_qty, total_revenue | Format-Table -AutoSize

Write-Host "Produits en stock faible :" -ForegroundColor Yellow
if ($stats.low_stock.Count -gt 0) {
    $stats.low_stock | Select-Object name, stock, min_stock | Format-Table -AutoSize
} else {
    Write-Host "Aucun produit en stock faible" -ForegroundColor Green
}

Write-Host ""
Write-Host "🎉 Tous les tests sont terminés !" -ForegroundColor Green
Write-Host ""
Write-Host "📚 Prochaines étapes :" -ForegroundColor Cyan
Write-Host "1. Ouvrez http://localhost:8000/api/docs/ pour explorer l'API" -ForegroundColor White
Write-Host "2. Testez le frontend avec: cd frontend && npm run dev" -ForegroundColor White
Write-Host "3. Connectez-vous avec admin/admin123" -ForegroundColor White
