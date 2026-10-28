/**
 * Controlador da aplicação ConvertX.
 * Orquestra estado, DOM, validação, formatação e atualização periódica.
 */
(() => {
    'use strict';

    // ----------------------------------------------------------------
    // Referências de DOM
    // ----------------------------------------------------------------
    const els = {
        amount: document.getElementById('amount'),
        amountWrapper: document.querySelector('#amount')?.closest('.input-wrapper'),
        amountError: document.getElementById('amount-error'),
        currency: document.getElementById('currency'),
        convertedValue: document.getElementById('converted-value'),
        rateInfo: document.getElementById('rate-info'),
        statusBadge: document.getElementById('status-badge'),
        ratesGrid: document.getElementById('rates-grid'),
        ratesHint: document.getElementById('rates-hint')
    };

    // ----------------------------------------------------------------
    // Estado
    // ----------------------------------------------------------------
    const state = {
        rates: null,             // { USD, EUR, BTC }
        timestamps: null,        // { USD, EUR, BTC }
        lastFetchAt: null,       // Date
        isFetching: false,
        abortController: null,
        updateTimerId: null,
        debounceTimerId: null
    };

    const UPDATE_INTERVAL_MS = 60_000;
    const DEBOUNCE_MS = 350;

    const CURRENCY_META = {
        USD: { code: 'USD', name: 'Dólar americano', locale: 'en-US' },
        EUR: { code: 'EUR', name: 'Euro',            locale: 'de-DE' },
        BTC: { code: 'BTC', name: 'Bitcoin',         locale: null    }
    };

    // ----------------------------------------------------------------
    // Formatadores
    // ----------------------------------------------------------------
    const brlFormatter = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });

    const brlCompactFormatter = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        maximumFractionDigits: 2
    });

    const btcFormatter = new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 8
    });

    const usdFormatter = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'USD'
    });

    const eurFormatter = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'EUR'
    });

    function formatBRL(value) {
        return brlFormatter.format(value);
    }

    function formatTarget(value, currency) {
        if (currency === 'BTC') {
            return `${btcFormatter.format(value)} BTC`;
        }
        if (currency === 'USD') return usdFormatter.format(value);
        if (currency === 'EUR') return eurFormatter.format(value);
        return value.toFixed(2);
    }

    // ----------------------------------------------------------------
    // Parsing de entrada (aceita formato brasileiro)
    // ----------------------------------------------------------------
    function parseAmount(raw) {
        if (typeof raw !== 'string') return null;
        const trimmed = raw.trim();
        if (trimmed === '') return { empty: true, value: null };

        // Remove "R$", espaços e separadores de milhar, preserva dígitos e vírgula/ponto
        let cleaned = trimmed
            .replace(/R\$\s?/gi, '')
            .replace(/\s+/g, '');

        // Se houver vírgula, tratamos como separador decimal
        if (cleaned.includes(',')) {
            cleaned = cleaned.replace(/\./g, '').replace(',', '.');
        } else {
            // Sem vírgula: remove pontos que sejam separadores de milhar
            // Ex.: "1.000" -> 1000 ; "10.50" (usuário digitou ponto) -> 10.50
            // Estratégia: se houver mais de um ponto, todos menos o último são milhar
            const parts = cleaned.split('.');
            if (parts.length > 2) {
                cleaned = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
            }
        }

        cleaned = cleaned.replace(/[^0-9.]/g, '');
        if (cleaned === '' || cleaned === '.') return { empty: false, value: null };

        const num = Number(cleaned);
        if (!Number.isFinite(num)) return { empty: false, value: null };
        return { empty: false, value: num };
    }

    // ----------------------------------------------------------------
    // Status da cotação
    // ----------------------------------------------------------------
    function setStatus(stateName, label) {
        if (!els.statusBadge) return;
        els.statusBadge.dataset.state = stateName;
        els.statusBadge.textContent = label;
    }

    // ----------------------------------------------------------------
    // Renderização dos cards de cotação
    // ----------------------------------------------------------------
    function renderRates() {
        if (!els.ratesGrid) return;

        if (!state.rates) {
            els.ratesGrid.innerHTML = '';
            for (let i = 0; i < 3; i++) {
                const sk = document.createElement('div');
                sk.className = 'rate-skeleton';
                els.ratesGrid.appendChild(sk);
            }
            return;
        }

        els.ratesGrid.innerHTML = '';
        const order = ['USD', 'EUR', 'BTC'];

        for (const code of order) {
            const meta = CURRENCY_META[code];
            const rate = state.rates[code];
            const ts = state.timestamps?.[code] ?? null;

            const card = document.createElement('article');
            card.className = 'rate-card' + (rate == null ? ' unavailable' : '');

            const header = document.createElement('div');
            header.className = 'rate-card-header';
            header.innerHTML = `
                <span class="rate-code">${meta.code}</span>
                <span class="rate-name">${meta.name}</span>
            `;

            const value = document.createElement('div');
            value.className = 'rate-value';
            value.textContent = rate != null
                ? brlCompactFormatter.format(rate)
                : 'Indisponível';

            const time = document.createElement('div');
            time.className = 'rate-time';
            time.textContent = ts
                ? `Atualizado em ${ts}`
                : 'Horário não informado';

            card.append(header, value, time);
            els.ratesGrid.appendChild(card);
        }
    }

    // ----------------------------------------------------------------
    // Conversão
    // ----------------------------------------------------------------
    function validateAndRenderConversion() {
        const target = els.currency.value;
        const parsed = parseAmount(els.amount.value);

        // Reset visual do erro
        els.amountError.textContent = '';
        els.amountWrapper?.classList.remove('invalid');

        // Campo vazio
        if (parsed.empty) {
            els.convertedValue.textContent = '—';
            els.rateInfo.textContent = 'Digite um valor para converter.';
            return;
        }

        // Entrada inválida ou negativa
        if (parsed.value == null || parsed.value < 0) {
            els.amountError.textContent = 'Informe um valor numérico positivo.';
            els.amountWrapper?.classList.add('invalid');
            els.convertedValue.textContent = '—';
            els.rateInfo.textContent = 'Valor inválido.';
            return;
        }

        // Cotação ausente
        const rate = state.rates?.[target];
        if (rate == null || !Number.isFinite(rate) || rate <= 0) {
            els.convertedValue.textContent = '—';
            els.rateInfo.textContent = 'Cotação indisponível para esta moeda.';
            return;
        }

        const converted = parsed.value / rate;

        // Valor convertido em destaque
        els.convertedValue.textContent = formatTarget(converted, target);

        // Taxa utilizada
        const rateFmt = target === 'BTC'
            ? brlFormatter.format(rate)
            : brlFormatter.format(rate);

        const origin = formatBRL(parsed.value);
        els.rateInfo.textContent = `${origin} · 1 ${target} = ${rateFmt}`;
    }

    // ----------------------------------------------------------------
    // Debounce
    // ----------------------------------------------------------------
    function debounce(fn, delay) {
        return function debounced(...args) {
            clearTimeout(state.debounceTimerId);
            state.debounceTimerId = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    // ----------------------------------------------------------------
    // Carregamento de dados
    // ----------------------------------------------------------------
    async function loadRates() {
        if (state.isFetching) return;
        state.isFetching = true;

        // Cancela requisição anterior (se houver) para evitar resposta obsoleta
        state.abortController?.abort();
        state.abortController = new AbortController();

        setStatus('loading', 'Atualizando');
        els.ratesHint.textContent = 'Consultando cotações...';

        try {
            const { rates, timestamps, errors } = await ExchangeAPI.fetchAllRates(
                state.abortController.signal
            );

            state.rates = rates;
            state.timestamps = timestamps;
            state.lastFetchAt = new Date();

            renderRates();
            validateAndRenderConversion();

            if (errors.length > 0 && Object.keys(rates).length < 3) {
                setStatus('error', 'Parcial');
                els.ratesHint.textContent =
                    'Algumas cotações não puderam ser atualizadas.';
            } else {
                setStatus('success', 'Atualizado');
                const time = state.lastFetchAt.toLocaleTimeString('pt-BR');
                els.ratesHint.textContent =
                    `Última atualização: ${time} · Atualiza a cada 60 s`;
            }
        } catch (error) {
            if (error?.name === 'AbortError') return;

            console.error('[ConvertX] Falha ao carregar cotações:', error);

            // Não exibe cotação antiga como se fosse atual
            state.rates = null;
            state.timestamps = null;

            renderRates();
            setStatus('error', 'Indisponível');
            els.ratesHint.textContent =
                'Não foi possível atualizar as cotações.';
            els.convertedValue.textContent = '—';
            els.rateInfo.textContent =
                'Cotações temporariamente indisponíveis. Tente novamente em instantes.';
        } finally {
            state.isFetching = false;
        }
    }

    // ----------------------------------------------------------------
    // Handlers
    // ----------------------------------------------------------------
    const handleAmountInput = debounce(validateAndRenderConversion, DEBOUNCE_MS);

    function bindEvents() {
        els.amount.addEventListener('input', handleAmountInput);
        els.amount.addEventListener('blur', () => {
            // Normaliza visualmente o valor digitado (opcional, apenas se válido)
            const parsed = parseAmount(els.amount.value);
            if (parsed.value != null && parsed.value >= 0) {
                els.amount.value = parsed.value.toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });
            }
            validateAndRenderConversion();
        });

        els.currency.addEventListener('change', validateAndRenderConversion);

        // Revalida ao voltar para a aba (evita mostrar dados desatualizados como atuais)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                const stale = !state.lastFetchAt ||
                    (Date.now() - state.lastFetchAt.getTime()) > UPDATE_INTERVAL_MS;
                if (stale) loadRates();
            }
        });
    }

    // ----------------------------------------------------------------
    // Inicialização
    // ----------------------------------------------------------------
    function start() {
        bindEvents();
        renderRates();
        loadRates();

        state.updateTimerId = setInterval(loadRates, UPDATE_INTERVAL_MS);

        window.addEventListener('beforeunload', () => {
            clearInterval(state.updateTimerId);
            state.abortController?.abort();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();