import NepaliDate, { dateConfigMap } from 'nepali-date-converter';

export const NEPALI_MONTH_KEYS = [
    'Baisakh',
    'Jestha',
    'Asar',
    'Shrawan',
    'Bhadra',
    'Aswin',
    'Kartik',
    'Mangsir',
    'Poush',
    'Magh',
    'Falgun',
    'Chaitra',
] as const;

export const NEPALI_MONTH_NAMES = [
    'Baisakh',
    'Jestha',
    'Ashadh',
    'Shrawan',
    'Bhadra',
    'Ashwin',
    'Kartik',
    'Mangsir',
    'Poush',
    'Magh',
    'Falgun',
    'Chaitra',
] as const;

export const BS_WEEKDAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

export type SupportedDateFormat = 'YYYY-MM-DD' | 'DD-MM-YYYY';

export type BsDateParts = {
    year: number;
    month: number; // 1..12
    day: number; // 1..32
    weekday: number; // 0..6
    monthName: string;
    iso: string; // YYYY-MM-DD
    formatted: string; // matches active dateFormat
    readable: string; // e.g., "2 Mangsir 2083"
};

export const SUPPORTED_BS_YEARS: number[] = Object.keys(dateConfigMap)
    .map(y => Number(y))
    .filter(y => !Number.isNaN(y))
    .sort((a, b) => a - b);

export const MIN_BS_YEAR = SUPPORTED_BS_YEARS[0] ?? 2000;
export const MAX_BS_YEAR = SUPPORTED_BS_YEARS[SUPPORTED_BS_YEARS.length - 1] ?? 2099;

const pad2 = (n: number): string => String(n).padStart(2, '0');

export const formatDateParts = (
    year: number,
    month: number,
    day: number,
    dateFormat: SupportedDateFormat = 'YYYY-MM-DD',
): string => {
    const yyyy = String(year).padStart(4, '0');
    const mm = pad2(month);
    const dd = pad2(day);
    return dateFormat === 'DD-MM-YYYY' ? `${dd}-${mm}-${yyyy}` : `${yyyy}-${mm}-${dd}`;
};

export const parseFormattedDateParts = (
    raw: string | null | undefined,
    dateFormat: SupportedDateFormat = 'YYYY-MM-DD',
): { year: number; month: number; day: number } | null => {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim().replace(/\//g, '-');
    if (!trimmed) return null;

    const isoPrefix = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
    if (isoPrefix && (dateFormat === 'YYYY-MM-DD' || trimmed.includes('T'))) {
        return {
            year: Number(isoPrefix[1]),
            month: Number(isoPrefix[2]),
            day: Number(isoPrefix[3]),
        };
    }

    if (dateFormat === 'DD-MM-YYYY') {
        const dmy = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (dmy) {
            return {
                year: Number(dmy[3]),
                month: Number(dmy[2]),
                day: Number(dmy[1]),
            };
        }
        if (isoPrefix) {
            return {
                year: Number(isoPrefix[1]),
                month: Number(isoPrefix[2]),
                day: Number(isoPrefix[3]),
            };
        }
    }

    return null;
};

export const parseStrictAdDateString = (
    raw: string | null | undefined,
    dateFormat: SupportedDateFormat = 'YYYY-MM-DD',
): Date | null => {
    const parts = parseFormattedDateParts(raw, dateFormat);
    if (!parts) return null;

    const { year, month, day } = parts;
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) {
        return null;
    }

    const jsDate = new Date(year, month - 1, day);
    if (
        jsDate.getFullYear() !== year ||
        jsDate.getMonth() !== month - 1 ||
        jsDate.getDate() !== day
    ) {
        return null;
    }

    return jsDate;
};

export const formatJsDateToAdIso = (jsDate: Date): string =>
    `${jsDate.getFullYear()}-${pad2(jsDate.getMonth() + 1)}-${pad2(jsDate.getDate())}`;

export const adStringToIso = (
    raw: string | null | undefined,
    dateFormat: SupportedDateFormat = 'YYYY-MM-DD',
): string | null => {
    const jsDate = parseStrictAdDateString(raw, dateFormat);
    return jsDate ? formatJsDateToAdIso(jsDate) : null;
};

export const getDaysInBsMonth = (year: number, month1To12: number): number => {
    const config = (dateConfigMap as Record<string, Record<string, number>>)[String(year)];
    if (!config) return 30;
    const key = NEPALI_MONTH_KEYS[month1To12 - 1];
    return key ? (config[key] ?? 30) : 30;
};

export const getBsMonthStartWeekday = (year: number, month1To12: number): number => {
    try {
        const firstDay = new NepaliDate(year, month1To12 - 1, 1);
        return firstDay.getDay();
    } catch {
        return 0;
    }
};

export const adStringToBsParts = (
    rawAd: string | null | undefined,
    dateFormat: SupportedDateFormat = 'YYYY-MM-DD',
): BsDateParts | null => {
    const jsDate = parseStrictAdDateString(rawAd, dateFormat);
    if (!jsDate) return null;

    try {
        const nd = NepaliDate.fromAD(jsDate);
        const year = nd.getYear();
        const month = nd.getMonth() + 1;
        const day = nd.getDate();
        const weekday = nd.getDay();
        const monthName = NEPALI_MONTH_NAMES[month - 1] ?? 'Baisakh';
        return {
            year,
            month,
            day,
            weekday,
            monthName,
            iso: `${year}-${pad2(month)}-${pad2(day)}`,
            formatted: formatDateParts(year, month, day, dateFormat),
            readable: `${day} ${monthName} ${year}`,
        };
    } catch {
        return null;
    }
};

export const bsPartsToAd = (
    year: number,
    month1To12: number,
    day: number,
    dateFormat: SupportedDateFormat = 'YYYY-MM-DD',
): { adIso: string; adFormatted: string; bsIso: string; bsFormatted: string; readable: string } | null => {
    if (year < MIN_BS_YEAR || year > MAX_BS_YEAR) return null;
    if (month1To12 < 1 || month1To12 > 12) return null;

    const maxDays = getDaysInBsMonth(year, month1To12);
    if (day < 1 || day > maxDays) return null;

    try {
        const nd = new NepaliDate(year, month1To12 - 1, day);
        const jsDate = nd.toJsDate();
        const adYear = jsDate.getFullYear();
        const adMonth = jsDate.getMonth() + 1;
        const adDay = jsDate.getDate();
        const monthName = NEPALI_MONTH_NAMES[month1To12 - 1] ?? 'Baisakh';

        return {
            adIso: `${adYear}-${pad2(adMonth)}-${pad2(adDay)}`,
            adFormatted: formatDateParts(adYear, adMonth, adDay, dateFormat),
            bsIso: `${year}-${pad2(month1To12)}-${pad2(day)}`,
            bsFormatted: formatDateParts(year, month1To12, day, dateFormat),
            readable: `${day} ${monthName} ${year}`,
        };
    } catch {
        return null;
    }
};

export type BsParseResult =
    | {
        valid: true;
        empty?: boolean;
        adIso?: string;
        adFormatted?: string;
        bsIso?: string;
        bsFormatted?: string;
        readable?: string;
    }
    | {
        valid: false;
        error: string;
        errorCode?: string;
    };

export const parseAndConvertBsInput = (
    rawBs: string | null | undefined,
    dateFormat: SupportedDateFormat = 'YYYY-MM-DD',
    calendarMaxAd?: string | null,
): BsParseResult => {
    const trimmed = (rawBs || '').trim();
    if (!trimmed) {
        return { valid: true, empty: true };
    }

    const parts = parseFormattedDateParts(trimmed, dateFormat);
    if (!parts) {
        return {
            valid: false,
            error: `Invalid Nepali (BS) date format. Expected ${dateFormat}`,
            errorCode: 'INVALID_DATE_FORMAT',
        };
    }

    const { year, month, day } = parts;
    if (year < MIN_BS_YEAR || year > MAX_BS_YEAR) {
        return {
            valid: false,
            error: `Nepali (BS) year must be between ${MIN_BS_YEAR} and ${MAX_BS_YEAR}`,
            errorCode: 'INVALID_DATE_OUT_OF_RANGE',
        };
    }

    if (month < 1 || month > 12) {
        return {
            valid: false,
            error: 'Nepali (BS) month must be between 01 and 12',
            errorCode: 'INVALID_DATE',
        };
    }

    const maxDays = getDaysInBsMonth(year, month);
    if (day < 1 || day > maxDays) {
        return {
            valid: false,
            error: `${NEPALI_MONTH_NAMES[month - 1]} ${year} BS has ${maxDays} days`,
            errorCode: 'INVALID_DATE',
        };
    }

    const converted = bsPartsToAd(year, month, day, dateFormat);
    if (!converted) {
        return {
            valid: false,
            error: 'Invalid Nepali (BS) date',
            errorCode: 'INVALID_DATE',
        };
    }

    if (calendarMaxAd) {
        const maxIso = adStringToIso(calendarMaxAd, dateFormat);
        if (maxIso && converted.adIso > maxIso) {
            return {
                valid: false,
                error: `Date ${converted.adFormatted} is greater than the maximum allowed date ${calendarMaxAd}.`,
                errorCode: 'INVALID_DATE_MORE_THAN_MAX',
            };
        }
    }

    return {
        valid: true,
        ...converted,
    };
};

export const getTodayBsParts = (dateFormat: SupportedDateFormat = 'YYYY-MM-DD'): BsDateParts => {
    const todayIso = formatJsDateToAdIso(new Date());
    const todayBs = adStringToBsParts(todayIso, dateFormat);
    if (todayBs) {
        return todayBs;
    }
    return {
        year: 2083,
        month: 8,
        day: 2,
        weekday: 3,
        monthName: 'Mangsir',
        iso: '2083-08-02',
        formatted: formatDateParts(2083, 8, 2, dateFormat),
        readable: '2 Mangsir 2083',
    };
};

export const isBsDayAfterMax = (
    bsYear: number,
    bsMonth: number,
    bsDay: number,
    dateFormat: SupportedDateFormat,
    calendarMaxAd?: string | null,
): boolean => {
    if (!calendarMaxAd) return false;
    const maxIso = adStringToIso(calendarMaxAd, dateFormat);
    if (!maxIso) return false;
    const converted = bsPartsToAd(bsYear, bsMonth, bsDay, dateFormat);
    if (!converted) return false;
    return converted.adIso > maxIso;
};
