$plants = @(
    @{ title = 'Herbal_medicine'; filename = 'hero.jpg' },
    @{ title = 'Aloe_vera'; filename = 'sabila.jpg' },
    @{ title = 'Malva_sylvestris'; filename = 'marba.jpg' },
    @{ title = 'Dianthus'; filename = 'clavellina.jpg' },
    @{ title = 'Oregano'; filename = 'oregano.jpg' },
    @{ title = 'Lemon'; filename = 'limon.jpg' },
    @{ title = 'Chamomile'; filename = 'manzanilla.jpg' },
    @{ title = 'Green_tea'; filename = 'teverde.jpg' },
    @{ title = 'Spearmint'; filename = 'hierbabuena.jpg' },
    @{ title = 'Eucalyptus_globulus'; filename = 'eucalipto.jpg' },
    @{ title = 'Ginger'; filename = 'jengibre.jpg' }
)

$imgDir = "c:\Users\Admin\Documents\proje\img"
if (-not (Test-Path $imgDir)) {
    New-Item -ItemType Directory -Force -Path $imgDir | Out-Null
}

foreach ($plant in $plants) {
    try {
        $url = "https://en.wikipedia.org/api/rest_v1/page/summary/$($plant.title)"
        $response = Invoke-RestMethod -Uri $url -Headers @{ "User-Agent" = "PlantCatalogBot/1.0" }
        
        $imgUrl = $null
        if ($response.originalimage -and $response.originalimage.source) {
            $imgUrl = $response.originalimage.source
        } elseif ($response.thumbnail -and $response.thumbnail.source) {
            $imgUrl = $response.thumbnail.source
        }

        if ($imgUrl) {
            $dest = Join-Path $imgDir $plant.filename
            Invoke-WebRequest -Uri $imgUrl -OutFile $dest
            Write-Host "Downloaded $($plant.filename) successfully."
        } else {
            Write-Host "No image found for $($plant.title)"
        }
    } catch {
        Write-Host "Failed to fetch $($plant.title): $_"
    }
}
Write-Host "All downloads completed."
