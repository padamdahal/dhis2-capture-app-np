import React from 'react';
import { CalendarInput } from '@dhis2/ui';
import { NepalDateAddonBridge } from 'capture-nepal/runtime/extensionHost';
import type { Props, State, Validation, ValidationOptions } from './Date.types';

export class DateField extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);

        this.handleDateSelected = this.handleDateSelected.bind(this);
        this.handleNepaliDateSelected = this.handleNepaliDateSelected.bind(this);
    }

    handleDateSelected = (value: { calendarDateString: string, validation: Validation}) => {
        const { calendarDateString: date, validation } = value || {};
        this.props.onBlur(
            date, {
                error: validation?.validationText,
                errorCode: validation?.validationCode,
            });

        this.props.onDateSelectedFromCalendar?.();
    }

    handleNepaliDateSelected = (adDate: string | null, validationOptions: ValidationOptions) => {
        this.props.onBlur(adDate, validationOptions);
    }

    render() {
        const {
            width = '100%',
            maxWidth,
            calendarWidth,
            inputWidth,
            calendarMax,
            value,
            innerMessage,
            calendarType,
            dateFormat,
            locale,
            validation,
            hideNepaliPicker,
        } = this.props;
        const calculatedInputWidth = inputWidth || width;
        const calculatedCalendarWidth = calendarWidth || width;
        const calendar = (calendarType || 'gregory') as any;
        const format = (dateFormat || 'YYYY-MM-DD') as any;
        const showNepaliAddon = !hideNepaliPicker && (calendar === 'gregory' || calendar === 'iso8601');
        const errorProps = validation || (innerMessage && innerMessage.messageType === 'error'
            ? { error: !!innerMessage.message?.dateInnerErrorMessage,
                validationText: innerMessage.message?.dateInnerErrorMessage }
            : {});

        const calendarInputElement = (
            <CalendarInput
                label=""
                placeholder={this.props.placeholder}
                format={format}
                onDateSelect={this.handleDateSelected as any}
                calendar={calendar}
                date={value}
                width={String(calculatedCalendarWidth)}
                inputWidth={showNepaliAddon ? '100%' : String(calculatedInputWidth)}
                onFocus={this.props.onFocus}
                disabled={!!this.props.disabled}
                locale={locale}
                maxDate={calendarMax}
                {...errorProps as any}
            />
        );

        if (showNepaliAddon) {
            return (
                <NepalDateAddonBridge
                    adValue={typeof value === 'string' ? value : null}
                    dateFormat={format}
                    disabled={!!this.props.disabled}
                    calendarMax={typeof calendarMax === 'string' ? calendarMax : null}
                    width={width}
                    maxWidth={maxWidth}
                    onSelectAdDate={this.handleNepaliDateSelected}
                    onDateSelectedFromCalendar={this.props.onDateSelectedFromCalendar}
                >
                    {calendarInputElement}
                </NepalDateAddonBridge>
            );
        }

        return (
            <div
                style={{
                    width,
                    maxWidth: maxWidth || undefined,
                }}
            >
                {calendarInputElement}
            </div>
        );
    }
}
