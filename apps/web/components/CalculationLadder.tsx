'use client';

import type { ResourceResult } from '@geo/core';
import { formatAuto } from '../lib/format';

interface Step {
  symbol: string;
  name: string;
  value: number;
  unit: string;
  formula: string;
}

/**
 * The deterministic chain rendered step by step.
 *
 * Showing every intermediate rather than just the answer is what lets a reader check the
 * physics: an implausible final number can be traced to the step that produced it,
 * instead of merely doubted.
 */
export function CalculationLadder({ result }: { result: ResourceResult }) {
  const steps: Step[] = [
    {
      symbol: 'CT',
      name: 'Combined heat capacity',
      value: result.ctKjM3C,
      unit: 'kJ/m³/°C',
      formula: 'ρ(T)·cp(T)·φ + (1−φ)·CR',
    },
    {
      symbol: 'QR',
      name: 'Thermal energy in place',
      value: result.qrPj,
      unit: 'PJ',
      formula: 'A·H·CT·(T−Ta) / 10⁶',
    },
    {
      symbol: 'QWH',
      name: 'Energy recovered at wellhead',
      value: result.qwhPj,
      unit: 'PJ',
      formula: 'QR·R',
    },
    {
      symbol: 'hWH',
      name: 'Wellhead enthalpy',
      value: result.hwhKjKg,
      unit: 'kJ/kg',
      formula: 'hL(T) − D·9.81/1000',
    },
    { symbol: 'ho', name: 'Ambient enthalpy', value: result.hoKjKg, unit: 'kJ/kg', formula: 'hL(Ta)' },
    {
      symbol: 'sWH',
      name: 'Wellhead entropy',
      value: result.swhKjKgK,
      unit: 'kJ/kg/K',
      formula: 's(psat(T), hWH)',
    },
    { symbol: 'so', name: 'Ambient entropy', value: result.soKjKgK, unit: 'kJ/kg/K', formula: 'sL(Ta)' },
    {
      symbol: 'mWH',
      name: 'Mass produced',
      value: result.mwhPg,
      unit: 'Pg',
      formula: 'QWH / (hWH − ho)',
    },
    {
      symbol: 'WA',
      name: 'Available work',
      value: result.waPj,
      unit: 'PJ',
      formula: 'mWH·(hWH − ho − Ta,K·(sWH − so))',
    },
    { symbol: 'E', name: 'Electrical energy', value: result.ePj, unit: 'PJ', formula: 'WA·u' },
    {
      symbol: 'P',
      name: 'Generation capacity',
      value: result.capacityMwe,
      unit: 'MWe',
      formula: 'E·10⁹ / (F·L·365.25·24·3600)',
    },
  ];

  return (
    <table className="data-table data-table--ladder">
      <caption className="visually-hidden">
        Deterministic calculation chain for the most-likely input case
      </caption>
      <thead>
        <tr>
          <th scope="col">Step</th>
          <th scope="col">Relationship</th>
          <th scope="col" className="numeric">
            Value
          </th>
          <th scope="col">Unit</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((step, index) => (
          <tr key={step.symbol} className={index === steps.length - 1 ? 'is-result' : undefined}>
            <th scope="row">
              <span className="symbol">{step.symbol}</span> {step.name}
            </th>
            <td className="formula">{step.formula}</td>
            <td className="numeric tabular">{formatAuto(step.value)}</td>
            <td className="unit">{step.unit}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
