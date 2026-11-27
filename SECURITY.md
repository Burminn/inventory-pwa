# Security policy

Zgłoszenia podatności: GitHub → Security → *Report a vulnerability* (nie otwieraj publicznego issue). Odpowiadam w ciągu 7 dni.

Model zagrożeń: aplikacja działa w całości w przeglądarce, niczego nie wysyła do sieci i nie ma serwera ani kont.
Za niezaufane uznajemy pliki wczytywane przez użytkownika (xlsx, csv, JSON z innego telefonu) — dlatego dane trafiają do DOM
wyłącznie przez `textContent`, słowniki o kluczach z danych są `Map`-ami, a JSON sesji jest walidowany pole po polu.
CSP (meta) dopuszcza tylko skrypty i style z własnej domeny. Znane ograniczenia: README → „Znane ograniczenia”.
