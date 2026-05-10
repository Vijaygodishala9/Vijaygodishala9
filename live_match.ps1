while ($true) {
    try {
        $headers = @{ 'x-rapidapi-key' = 'b229907d-774f-4846-aa97-4c4da448a85a' }
        $match = Invoke-RestMethod -Uri 'https://cricket.highlightly.net/matches/53525467' -Method Get -Headers $headers
        Write-Host "$(Get-Date -Format 'HH:mm:ss') - State: $($match.state.description), Score: $($match.state.teams.home.score) ($($match.state.teams.home.info)), Prediction: SRH $($match.predictions.live[0].probabilities.home)"
    } catch {
        Write-Host "Error fetching data: $_"
    }
    Start-Sleep -Seconds 10
}