import { Link } from 'react-router-dom'

export default function Pricing({ plans }) {
  return (
    <section id="pricing" className="home__section">
      <div className="home__container">
        <header className="home__head">
          <h2 className="heading-lg">Simple pricing</h2>
          <p className="fog">Start free. Upgrade when you need more signals.</p>
        </header>
        <div className="plans">
          {plans.map((plan) => (
            <article key={plan.name} className={`card plan${plan.popular ? ' plan--popular' : ''}`}>
              <div className="plan__head">
                <h3 className="heading-sm">{plan.name}</h3>
                {plan.popular && <span className="pill pill--sm plan__tag">Popular</span>}
              </div>
              <p className="fog">{plan.blurb}</p>
              <p className="plan__price">
                <span className="mono">${plan.price}</span>
                <span className="fog">/month</span>
              </p>
              <ul className="plan__features">
                {plan.features.map((f) => (
                  <li key={f}>
                    <span className="plan__check" aria-hidden="true">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link to="/markets" className={plan.popular ? 'btn-primary' : 'btn-outline'}>
                {plan.cta}
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
