$photos = 'C:\Users\Windows 11\Desktop\projects\2026\website\photos'

Write-Host "Files before rename:"
Get-ChildItem $photos | ForEach-Object { Write-Host "  $($_.Name) ($($_.Name.Length) chars)" }

Write-Host ""
Write-Host "Renaming (stripping combining diacritics)..."

Get-ChildItem $photos -Filter '*.jpg' | ForEach-Object {
    # Remove ALL combining diacritic marks (U+0300-U+036F range)
    $newName = [System.Text.RegularExpressions.Regex]::Replace(
        $_.Name, '[\u0300-\u036F]', '')
    if ($newName -ne $_.Name) {
        Write-Host "  $($_.Name) --> $newName"
        Rename-Item $_.FullName $newName
    } else {
        Write-Host "  (no change) $($_.Name)"
    }
}

Write-Host ""
Write-Host "Files after rename:"
Get-ChildItem $photos | ForEach-Object { Write-Host "  $($_.Name)" }
