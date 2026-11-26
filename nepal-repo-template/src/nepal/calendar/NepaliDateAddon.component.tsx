import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Button,
    IconCalendar16,
    IconChevronLeft16,
    IconChevronRight16,
    InputField,
    Layer,
    Popper,
    colors,
    elevations,
    spacers,
} from '@dhis2/ui';
import {
    BS_WEEKDAY_SHORT,
    MAX_BS_YEAR,
    MIN_BS_YEAR,
    NEPALI_MONTH_NAMES,
    SUPPORTED_BS_YEARS,
    adStringToBsParts,
    bsPartsToAd,
    getBsMonthStartWeekday,
    getDaysInBsMonth,
    getTodayBsParts,
    isBsDayAfterMax,
    parseAndConvertBsInput,
    type SupportedDateFormat,
} from './nepaliDate';

export type NepaliValidationOptions = {
    error?: string | null;
    errorCode?: string | null;
};

export type NepaliDateAddonProps = {
    adValue?: string | null;
    dateFormat?: SupportedDateFormat | null;
    disabled?: boolean | null;
    calendarMax?: string | null;
    width?: string | number;
    maxWidth?: string | number | null;
    onSelectAdDate: (adValue: string | null, validationOptions: NepaliValidationOptions) => void;
    onDateSelectedFromCalendar?: () => void;
    children: React.ReactNode;
};

const popperModifiers: Array<{
    name: 'offset' | 'preventOverflow' | 'flip';
    options: Record<string, any>;
}> = [
    {
        name: 'offset',
        options: {
            offset: [0, 4],
        },
    },
    {
        name: 'preventOverflow',
        options: {
            padding: 8,
        },
    },
    {
        name: 'flip',
        options: {
            fallbackPlacements: ['bottom-start', 'top-end', 'top-start'],
        },
    },
];

export const NepaliDateAddon: React.FC<NepaliDateAddonProps> = ({
    adValue,
    dateFormat,
    disabled,
    calendarMax,
    width = '100%',
    maxWidth,
    onSelectAdDate,
    onDateSelectedFromCalendar,
    children,
}) => {
    const activeFormat: SupportedDateFormat = dateFormat === 'DD-MM-YYYY' ? 'DD-MM-YYYY' : 'YYYY-MM-DD';
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const popoverRef = useRef<HTMLDivElement | null>(null);

    const syncedBs = useMemo(
        () => adStringToBsParts(adValue, activeFormat),
        [adValue, activeFormat],
    );

    const todayBs = useMemo(() => getTodayBsParts(activeFormat), [activeFormat]);

    const [bsInput, setBsInput] = useState<string>(syncedBs?.formatted || '');
    const [bsError, setBsError] = useState<string | null>(null);
    const [open, setOpen] = useState<boolean>(false);
    const [viewYear, setViewYear] = useState<number>(syncedBs?.year ?? todayBs.year);
    const [viewMonth, setViewMonth] = useState<number>(syncedBs?.month ?? todayBs.month);

    useEffect(() => {
        setBsInput(syncedBs?.formatted || '');
        setBsError(null);
        if (syncedBs) {
            setViewYear(syncedBs.year);
            setViewMonth(syncedBs.month);
        }
    }, [syncedBs?.formatted, adValue]);

    const toggleOpen = () => {
        if (disabled) return;
        setBsError(null);
        setOpen((prev) => {
            const next = !prev;
            if (next) {
                setViewYear(syncedBs?.year ?? todayBs.year);
                setViewMonth(syncedBs?.month ?? todayBs.month);
                setBsInput(syncedBs?.formatted || '');
            }
            return next;
        });
    };

    const commitBsString = (raw: string, closeOnSuccess = true) => {
        const result = parseAndConvertBsInput(raw, activeFormat, calendarMax);
        if (result.valid === false) {
            setBsError(result.error);
            if (result.errorCode === 'INVALID_DATE_MORE_THAN_MAX') {
                onSelectAdDate(raw.trim(), {
                    error: result.error,
                    errorCode: result.errorCode,
                });
            }
            return;
        }

        setBsError(null);
        if (result.empty || !result.adFormatted) {
            setBsInput('');
            onSelectAdDate(null, {});
            if (closeOnSuccess) setOpen(false);
            return;
        }

        setBsInput(result.bsFormatted || '');
        onSelectAdDate(result.adFormatted, { error: null, errorCode: null });
        onDateSelectedFromCalendar?.();
        if (closeOnSuccess) setOpen(false);
    };

    const handleDaySelect = (day: number) => {
        if (disabled) return;
        if (isBsDayAfterMax(viewYear, viewMonth, day, activeFormat, calendarMax)) {
            return;
        }
        const converted = bsPartsToAd(viewYear, viewMonth, day, activeFormat);
        if (!converted) return;

        setBsError(null);
        setBsInput(converted.bsFormatted);
        setOpen(false);
        onSelectAdDate(converted.adFormatted, { error: null, errorCode: null });
        onDateSelectedFromCalendar?.();
    };

    const handlePrevMonth = () => {
        if (viewMonth === 1) {
            if (viewYear > MIN_BS_YEAR) {
                setViewYear(viewYear - 1);
                setViewMonth(12);
            }
        } else {
            setViewMonth(viewMonth - 1);
        }
    };

    const handleNextMonth = () => {
        if (viewMonth === 12) {
            if (viewYear < MAX_BS_YEAR) {
                setViewYear(viewYear + 1);
                setViewMonth(1);
            }
        } else {
            setViewMonth(viewMonth + 1);
        }
    };

    const handleSelectToday = () => {
        if (disabled) return;
        if (isBsDayAfterMax(todayBs.year, todayBs.month, todayBs.day, activeFormat, calendarMax)) {
            return;
        }
        const converted = bsPartsToAd(todayBs.year, todayBs.month, todayBs.day, activeFormat);
        if (!converted) return;
        setViewYear(todayBs.year);
        setViewMonth(todayBs.month);
        setBsError(null);
        setBsInput(converted.bsFormatted);
        setOpen(false);
        onSelectAdDate(converted.adFormatted, { error: null, errorCode: null });
        onDateSelectedFromCalendar?.();
    };

    const handleClear = () => {
        if (disabled) return;
        setBsError(null);
        setBsInput('');
        setOpen(false);
        onSelectAdDate(null, {});
    };

    const daysInMonth = useMemo(() => getDaysInBsMonth(viewYear, viewMonth), [viewYear, viewMonth]);
    const startWeekday = useMemo(() => getBsMonthStartWeekday(viewYear, viewMonth), [viewYear, viewMonth]);

    const calendarCells = useMemo(() => {
        const cells: Array<number | null> = [];
        for (let i = 0; i < startWeekday; i += 1) {
            cells.push(null);
        }
        for (let d = 1; d <= daysInMonth; d += 1) {
            cells.push(d);
        }
        while (cells.length % 7 !== 0) {
            cells.push(null);
        }
        return cells;
    }, [daysInMonth, startWeekday]);

    const normalizedWidth = typeof width === 'number' ? `${width}px` : String(width || '100%');
    const normalizedMaxWidth = maxWidth
        ? (typeof maxWidth === 'number' ? `${maxWidth}px` : String(maxWidth))
        : undefined;

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: spacers.dp4,
                width: normalizedWidth,
                maxWidth: normalizedMaxWidth,
            }}
            data-test="nepali-bs-date-container"
        >
            <div
                style={{
                    position: 'relative',
                    flex: 1,
                    minWidth: 0,
                }}
            >
                {children}
                {syncedBs && (
                    <button
                        type="button"
                        disabled={!!disabled}
                        onClick={toggleOpen}
                        title={`${syncedBs.readable} BS — Click to pick Nepali (BS) date`}
                        data-test="nepali-bs-date-pill"
                        style={{
                            position: 'absolute',
                            top: '-9px',
                            right: '6px',
                            zIndex: 2,
                            display: 'inline-flex',
                            alignItems: 'center',
                            height: '18px',
                            padding: '0 6px',
                            borderRadius: '999px',
                            border: `1px solid ${colors.blue300}`,
                            backgroundColor: colors.blue050,
                            color: colors.blue800,
                            fontSize: '10.5px',
                            fontWeight: 600,
                            lineHeight: '14px',
                            letterSpacing: '0.01em',
                            whiteSpace: 'nowrap',
                            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08)',
                            cursor: disabled ? 'default' : 'pointer',
                            maxWidth: 'calc(100% - 12px)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                        }}
                    >
                        {syncedBs.formatted} BS
                    </button>
                )}
            </div>

            <button
                ref={triggerRef}
                type="button"
                aria-label="Open Nepali BS calendar"
                title={syncedBs ? `Nepali (BS): ${syncedBs.readable} BS` : 'Open Nepali (BS) calendar'}
                disabled={!!disabled}
                onClick={toggleOpen}
                data-test="nepali-bs-trigger-button"
                style={{
                    display: 'inline-flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '1px',
                    height: '40px',
                    width: '36px',
                    flexShrink: 0,
                    borderRadius: '3px',
                    border: `1px solid ${open ? colors.blue600 : colors.grey500}`,
                    backgroundColor: open ? colors.blue050 : colors.white,
                    color: disabled ? colors.grey500 : (open ? colors.blue700 : colors.grey800),
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    padding: '2px 0',
                }}
            >
                <IconCalendar16 />
                <span
                    style={{
                        fontSize: '9px',
                        fontWeight: 700,
                        lineHeight: '9px',
                        letterSpacing: '0.04em',
                    }}
                >
                    BS
                </span>
            </button>

            {open && !disabled && (
                <Layer onBackdropClick={() => setOpen(false)}>
                    <Popper
                        reference={triggerRef}
                        placement="bottom-end"
                        modifiers={popperModifiers}
                    >
                        <div
                            ref={popoverRef}
                            tabIndex={-1}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    setOpen(false);
                                }
                            }}
                            style={{
                                width: '292px',
                                backgroundColor: colors.white,
                                border: `1px solid ${colors.grey300}`,
                                borderRadius: '3px',
                                boxShadow: elevations.e300,
                                padding: spacers.dp8,
                                fontFamily: 'inherit',
                            }}
                            data-test="nepali-bs-calendar-popover"
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: spacers.dp8,
                                    marginBottom: spacers.dp8,
                                    fontSize: '12px',
                                    lineHeight: '14px',
                                    color: colors.grey700,
                                }}
                            >
                                <span style={{ fontWeight: 600, color: colors.grey900 }}>
                                    Nepali Date (BS)
                                </span>
                                {syncedBs && (
                                    <span
                                        style={{
                                            color: colors.blue700,
                                            fontWeight: 500,
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {syncedBs.readable}
                                    </span>
                                )}
                            </div>

                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: spacers.dp4,
                                    marginBottom: spacers.dp8,
                                }}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <InputField
                                        dense
                                        type="text"
                                        dataTest="nepali-bs-date-input"
                                        placeholder={`${activeFormat.toLowerCase()} (BS)`}
                                        value={bsInput}
                                        error={!!bsError}
                                        validationText={bsError || undefined}
                                        onChange={({ value }: { value?: string }) => {
                                            const next = value ?? '';
                                            setBsInput(next);
                                            if (!next.trim()) {
                                                setBsError(null);
                                            }
                                        }}
                                        onKeyDown={(_payload: any, event?: React.KeyboardEvent<HTMLInputElement>) => {
                                            if (event?.key === 'Enter') {
                                                event.preventDefault();
                                                commitBsString(bsInput, true);
                                            } else if (event?.key === 'Escape') {
                                                setOpen(false);
                                            }
                                        }}
                                    />
                                </div>
                                <Button
                                    small
                                    secondary
                                    onClick={() => commitBsString(bsInput, true)}
                                >
                                    Set
                                </Button>
                            </div>

                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: spacers.dp4,
                                    marginBottom: spacers.dp8,
                                }}
                            >
                                <button
                                    type="button"
                                    aria-label="Previous BS month"
                                    onClick={handlePrevMonth}
                                    disabled={viewYear === MIN_BS_YEAR && viewMonth === 1}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '28px',
                                        height: '28px',
                                        border: `1px solid ${colors.grey300}`,
                                        borderRadius: '3px',
                                        background: colors.white,
                                        cursor: 'pointer',
                                        color: colors.grey800,
                                    }}
                                >
                                    <IconChevronLeft16 />
                                </button>

                                <div style={{ display: 'flex', alignItems: 'center', gap: spacers.dp4 }}>
                                    <select
                                        aria-label="Nepali month"
                                        value={viewMonth}
                                        onChange={e => setViewMonth(Number(e.target.value))}
                                        style={{
                                            height: '28px',
                                            padding: '0 6px',
                                            fontSize: '13px',
                                            fontWeight: 500,
                                            borderRadius: '3px',
                                            border: `1px solid ${colors.grey400}`,
                                            background: colors.white,
                                            color: colors.grey900,
                                        }}
                                    >
                                        {NEPALI_MONTH_NAMES.map((name, idx) => (
                                            <option key={name} value={idx + 1}>
                                                {name}
                                            </option>
                                        ))}
                                    </select>

                                    <select
                                        aria-label="Nepali year"
                                        value={viewYear}
                                        onChange={e => setViewYear(Number(e.target.value))}
                                        style={{
                                            height: '28px',
                                            padding: '0 6px',
                                            fontSize: '13px',
                                            fontWeight: 500,
                                            borderRadius: '3px',
                                            border: `1px solid ${colors.grey400}`,
                                            background: colors.white,
                                            color: colors.grey900,
                                        }}
                                    >
                                        {SUPPORTED_BS_YEARS.map(yr => (
                                            <option key={yr} value={yr}>
                                                {yr}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <button
                                    type="button"
                                    aria-label="Next BS month"
                                    onClick={handleNextMonth}
                                    disabled={viewYear === MAX_BS_YEAR && viewMonth === 12}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '28px',
                                        height: '28px',
                                        border: `1px solid ${colors.grey300}`,
                                        borderRadius: '3px',
                                        background: colors.white,
                                        cursor: 'pointer',
                                        color: colors.grey800,
                                    }}
                                >
                                    <IconChevronRight16 />
                                </button>
                            </div>

                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(7, 1fr)',
                                    gap: '2px',
                                    textAlign: 'center',
                                    marginBottom: spacers.dp4,
                                }}
                            >
                                {BS_WEEKDAY_SHORT.map((wd, idx) => (
                                    <div
                                        key={wd}
                                        style={{
                                            fontSize: '11px',
                                            fontWeight: 600,
                                            padding: '4px 0',
                                            color: idx === 6 ? colors.red600 : colors.grey600,
                                        }}
                                    >
                                        {wd}
                                    </div>
                                ))}
                            </div>

                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(7, 1fr)',
                                    gap: '2px',
                                }}
                            >
                                {calendarCells.map((day, idx) => {
                                    if (day === null) {
                                        return <div key={`empty-${idx}`} style={{ height: '30px' }} />;
                                    }

                                    const isSelected = Boolean(
                                        syncedBs &&
                                        syncedBs.year === viewYear &&
                                        syncedBs.month === viewMonth &&
                                        syncedBs.day === day,
                                    );
                                    const isToday =
                                        todayBs.year === viewYear &&
                                        todayBs.month === viewMonth &&
                                        todayBs.day === day;
                                    const isSaturday = idx % 7 === 6;
                                    const isFutureBlocked = isBsDayAfterMax(
                                        viewYear,
                                        viewMonth,
                                        day,
                                        activeFormat,
                                        calendarMax,
                                    );

                                    return (
                                        <button
                                            key={day}
                                            type="button"
                                            disabled={isFutureBlocked}
                                            onClick={() => handleDaySelect(day)}
                                            style={{
                                                height: '30px',
                                                borderRadius: '3px',
                                                border: isToday && !isSelected
                                                    ? `1px solid ${colors.blue500}`
                                                    : '1px solid transparent',
                                                backgroundColor: isSelected
                                                    ? colors.blue600
                                                    : 'transparent',
                                                color: isSelected
                                                    ? colors.white
                                                    : isFutureBlocked
                                                        ? colors.grey400
                                                        : isSaturday
                                                            ? colors.red600
                                                            : colors.grey900,
                                                fontSize: '12px',
                                                fontWeight: isSelected || isToday ? 600 : 400,
                                                cursor: isFutureBlocked ? 'not-allowed' : 'pointer',
                                            }}
                                        >
                                            {day}
                                        </button>
                                    );
                                })}
                            </div>

                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    marginTop: spacers.dp8,
                                    paddingTop: spacers.dp8,
                                    borderTop: `1px solid ${colors.grey200}`,
                                    fontSize: '11px',
                                    color: colors.grey700,
                                }}
                            >
                                <span>
                                    {adValue ? `AD: ${adValue}` : 'Select a BS date'}
                                </span>
                                <div style={{ display: 'flex', gap: spacers.dp4 }}>
                                    <Button small secondary onClick={handleSelectToday}>
                                        Today
                                    </Button>
                                    {adValue && (
                                        <Button small secondary onClick={handleClear}>
                                            Clear
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </Popper>
                </Layer>
            )}
        </div>
    );
};
