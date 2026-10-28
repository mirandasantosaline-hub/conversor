/**
 * Camada de serviço responsável por consultar as APIs externas
 * e devolver as cotações validadas para a aplicação.
 */
const ExchangeAPI = (() => {
    const FIAT_URL =
        'https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL';
    const BTC_URL =
        'https://api.coingecko.com/api/v3/simple/price' +
        '?ids=bitcoin&vs_currencies=brl&include_last_updated_at=true';

    const REQUEST_TIMEOUT_MS = 10000;

    /**
     * fetch com timeout e verificação de response.ok.
     */
    async function safeFetch(url, signal) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const composedSignal = signal
            ? anySignal([signal, controller.signal])
            : controller.signal;

        try {
            const response = await fetch(url, { signal: composedSignal });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} em ${url}`);
            }
            return await response.json();
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Combina múltiplos AbortSignals (fallback simples quando AbortSignal.any não existe).
     */
    function anySignal(signals) {
        if (typeof AbortSignal !== 'undefined' && AbortSignal.any) {
            return AbortSignal.any(signals);
        }
        const controller = new AbortController();
        for (const s of signals) {
            if (s.aborted) {
                controller.abort(s.reason);
                break;
            }
            s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
        }
        return controller.signal;
    }

    /**
     * Busca USD e EUR em BRL na AwesomeAPI.
     * Retorna { rates: { USD, EUR }, timestamps: { USD, EUR } } ou lança erro.
     */
    async function fetchFiatRates(signal) {
        const data = await safeFetch(FIAT_URL, signal);

        if (!data || typeof data !== 'object' || !data.USDBRL || !data.EURBRL) {
            throw new Error('Estrutura de resposta inválida (AwesomeAPI)');
        }

        const usd = Number(data.USDBRL.bid);
        const eur = Number(data.EURBRL.bid);

        if (!Number.isFinite(usd) || !Number.isFinite(eur) || usd <= 0 || eur <= 0) {
            throw new Error('Valores numéricos inválidos (AwesomeAPI)');
        }

        // create_date vem como "YYYY-MM-DD HH:mm:ss" (horário de Brasília)
        const ts = data.USDBRL.create_date || null;

        return {
            rates: { USD: usd, EUR: eur },
            timestamps: { USD: ts, EUR: ts }
        };
    }

    /**
     * Busca o preço do BTC em BRL na CoinGecko.
     * Retorna { rates: { BTC }, timestamps: { BTC } } ou lança erro.
     */
    async function fetchBitcoinRate(signal) {
        const data = await safeFetch(BTC_URL, signal);

        if (!data || !data.bitcoin || typeof data.bitcoin.brl !== 'number') {
            throw new Error('Estrutura de resposta inválida (CoinGecko)');
        }

        const btc = data.bitcoin.brl;
        if (!Number.isFinite(btc) || btc <= 0) {
            throw new Error('Valor numérico inválido (CoinGecko)');
        }

        const lastUpdated = Number(data.bitcoin.last_updated_at);
        const ts = Number.isFinite(lastUpdated)
            ? new Date(lastUpdated * 1000).toLocaleString('pt-BR')
            : null;

        return {
            rates: { BTC: btc },
            timestamps: { BTC: ts }
        };
    }

    /**
     * Consulta todas as fontes em paralelo.
     * Fontes indisponíveis não derrubam o resultado das demais.
     *
     * @returns {Promise<{
     *   rates: Record<string, number>,
     *   timestamps: Record<string, string|null>,
     *   errors: string[]
     * }>}
     */
    async function fetchAllRates(signal) {
        const results = await Promise.allSettled([
            fetchFiatRates(signal),
            fetchBitcoinRate(signal)
        ]);

        const rates = {};
        const timestamps = {};
        const errors = [];

        for (const result of results) {
            if (result.status === 'fulfilled') {
                Object.assign(rates, result.value.rates);
                Object.assign(timestamps, result.value.timestamps);
            } else {
                errors.push(result.reason?.message || 'Falha desconhecida');
            }
        }

        if (Object.keys(rates).length === 0) {
            throw new Error(
                'Nenhuma cotação pôde ser obtida. Verifique a conexão e tente novamente.'
            );
        }

        return { rates, timestamps, errors };
    }

    return { fetchAllRates };
})();